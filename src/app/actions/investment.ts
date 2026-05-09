"use server";

import { revalidateTag } from "next/cache";
import { z } from "zod";
import { getSupabaseServer } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth";
import { getPriceUnit } from "@/lib/stockList";

const TradeSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  user_id: z.string().uuid(),
  account_id: z.string().uuid().optional(),
  ticker: z.string().min(1).max(20),
  name: z.string().max(120).optional(),
  action: z.enum(["buy", "sell"]),
  quantity: z.number().positive(),
  price_usd: z.number().nonnegative(),
  exchange_rate: z.number().positive(),
  note: z.string().max(400).optional(),
});

export async function recordTrade(input: z.infer<typeof TradeSchema>) {
  const { household } = await requireSession();
  const hid = household.household_id;
  const p = TradeSchema.parse(input);
  const sb = getSupabaseServer();
  const priceUnit = getPriceUnit(p.ticker);
  const amountJpy = Math.round((p.quantity * p.price_usd) / priceUnit * p.exchange_rate);

  const { data: txn, error: txnErr } = await sb
    .from("transactions")
    .insert({
      household_id: hid,
      date: p.date,
      user_id: p.user_id,
      amount: amountJpy,
      category_type: p.action === "buy" ? "investment" : "income",
      subcategory: `${p.action === "buy" ? "投資購入" : "投資売却"} ${p.ticker}`,
      note: p.note ?? null,
      source: "investment-auto",
    })
    .select("id")
    .single();
  if (txnErr) throw new Error(txnErr.message);

  const { error: invErr } = await sb.from("investment_transactions").insert({
    household_id: hid,
    date: p.date,
    user_id: p.user_id,
    account_id: p.account_id ?? null,
    ticker: p.ticker,
    name: p.name ?? null,
    action: p.action,
    quantity: p.quantity,
    price_usd: p.price_usd,
    exchange_rate: p.exchange_rate,
    amount_jpy: amountJpy,
    linked_transaction_id: txn.id,
    note: p.note ?? null,
  });
  if (invErr) throw new Error(invErr.message);

  if (p.account_id) {
    await recalculateHoldingsFromTrades(p.account_id);
  }

  revalidateTag(`hh:${hid}:transactions`);
  revalidateTag(`hh:${hid}:investment-accounts`);
}

const HoldingSchema = z.object({
  account_id: z.string().uuid(),
  ticker: z.string().min(1),
  name: z.string().optional(),
  quantity: z.number().positive(),
  avg_cost_usd: z.number().nonnegative(),
  current_price_usd: z.number().nonnegative(),
  exchange_rate: z.number().positive(),
});

export async function upsertHolding(input: z.infer<typeof HoldingSchema>) {
  const { household } = await requireSession();
  const hid = household.household_id;
  const p = HoldingSchema.parse(input);
  const priceUnit = getPriceUnit(p.ticker);
  const total = Math.round((p.quantity * p.current_price_usd) / priceUnit * p.exchange_rate);
  const cost = Math.round((p.quantity * p.avg_cost_usd) / priceUnit * p.exchange_rate);
  const sb = getSupabaseServer();
  const { error } = await sb.from("investment_holdings").insert({
    household_id: hid,
    account_id: p.account_id,
    ticker: p.ticker,
    name: p.name ?? null,
    quantity: p.quantity,
    avg_cost_usd: p.avg_cost_usd,
    current_price_usd: p.current_price_usd,
    exchange_rate: p.exchange_rate,
    total_value_jpy: total,
    unrealized_gain_jpy: Math.round(total - cost),
  });
  if (error) throw new Error(error.message);
  revalidateTag(`hh:${hid}:investment-accounts`);
}

const AccountSchema = z.object({
  user_id: z.string().uuid(),
  provider: z.string().min(1),
  account_name: z.string().min(1),
});
export async function createAccount(input: z.infer<typeof AccountSchema>) {
  const { household } = await requireSession();
  const hid = household.household_id;
  const p = AccountSchema.parse(input);
  const sb = getSupabaseServer();
  const { error } = await sb.from("investment_accounts").insert({
    household_id: hid,
    user_id: p.user_id,
    provider: p.provider,
    account_name: p.account_name,
  });
  if (error) throw new Error(error.message);
  revalidateTag(`hh:${hid}:investment-accounts`);
}

const BulkTradeRow = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  user_id: z.string().uuid(),
  account_id: z.string().uuid().optional(),
  ticker: z.string().min(1).max(20),
  name: z.string().max(120).optional(),
  action: z.enum(["buy", "sell"]),
  quantity: z.number().positive(),
  price_usd: z.number().nonnegative(),
  exchange_rate: z.number().positive(),
  note: z.string().max(400).optional(),
});

export async function bulkRecordTrades(rows: z.infer<typeof BulkTradeRow>[]) {
  const { household } = await requireSession();
  const hid = household.household_id;
  const results: { ok: number; errors: string[] } = { ok: 0, errors: [] };
  for (let i = 0; i < rows.length; i++) {
    try {
      const parsed = BulkTradeRow.parse(rows[i]);
      await recordTrade(parsed);
      results.ok++;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      results.errors.push(`Row ${i + 1}: ${msg}`);
    }
  }
  const accountId = rows[0]?.account_id;
  if (accountId && results.ok > 0) {
    try {
      await recalculateHoldingsFromTrades(accountId);
    } catch (err: unknown) {
      results.errors.push(`保有計算エラー: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  revalidateTag(`hh:${hid}:transactions`);
  return results;
}

export async function recalculateHoldingsFromTrades(account_id: string) {
  const { household } = await requireSession();
  const hid = household.household_id;
  const sb = getSupabaseServer();

  const { error: delErr } = await sb
    .from("investment_holdings")
    .delete()
    .eq("household_id", hid)
    .eq("account_id", account_id);
  if (delErr) throw new Error(delErr.message);

  const { data: trades, error } = await sb
    .from("investment_transactions")
    .select("ticker, name, action, quantity, price_usd, exchange_rate, date")
    .eq("household_id", hid)
    .eq("account_id", account_id)
    .order("date", { ascending: true });
  if (error) throw new Error(error.message);

  const map = new Map<string, { name: string; qty: number; totalCost: number; rate: number }>();
  for (const t of trades ?? []) {
    const key = t.ticker;
    const prev = map.get(key) ?? { name: t.name ?? key, qty: 0, totalCost: 0, rate: t.exchange_rate };
    if (t.action === "buy") {
      prev.totalCost += t.quantity * t.price_usd;
      prev.qty += t.quantity;
    } else {
      const newQty = Math.max(0, prev.qty - t.quantity);
      if (prev.qty > 0) {
        prev.totalCost = prev.totalCost * (newQty / prev.qty);
      }
      prev.qty = newQty;
    }
    prev.rate = t.exchange_rate;
    map.set(key, prev);
  }

  for (const [ticker, pos] of map.entries()) {
    if (pos.qty <= 0) continue;
    const priceUnit = getPriceUnit(ticker);
    const avgCost = pos.qty > 0 ? pos.totalCost / pos.qty : 0;
    const totalJpy = Math.round((pos.qty * avgCost) / priceUnit * pos.rate);
    const { error: insErr } = await sb.from("investment_holdings").insert({
      household_id: hid,
      account_id,
      ticker,
      name: pos.name,
      quantity: pos.qty,
      avg_cost_usd: avgCost,
      current_price_usd: avgCost,
      exchange_rate: pos.rate,
      total_value_jpy: totalJpy,
      unrealized_gain_jpy: 0,
    });
    if (insErr) throw new Error(`${ticker}: ${insErr.message}`);
  }
  revalidateTag(`hh:${hid}:investment-accounts`);
}

export async function deleteAllInvestmentTransactions(account_id: string) {
  const { household } = await requireSession();
  const hid = household.household_id;
  const sb = getSupabaseServer();

  const { data: invTxns, error: fetchErr } = await sb
    .from("investment_transactions")
    .select("id, linked_transaction_id")
    .eq("household_id", hid)
    .eq("account_id", account_id);
  if (fetchErr) throw new Error(fetchErr.message);

  const { error: invErr } = await sb
    .from("investment_transactions")
    .delete()
    .eq("household_id", hid)
    .eq("account_id", account_id);
  if (invErr) throw new Error(invErr.message);

  const linkedIds = (invTxns ?? [])
    .map((t) => t.linked_transaction_id)
    .filter(Boolean) as string[];
  if (linkedIds.length > 0) {
    const { error: cashErr } = await sb
      .from("transactions")
      .delete()
      .eq("household_id", hid)
      .in("id", linkedIds);
    if (cashErr) throw new Error(cashErr.message);
  }

  const { error: holdErr } = await sb
    .from("investment_holdings")
    .delete()
    .eq("household_id", hid)
    .eq("account_id", account_id);
  if (holdErr) throw new Error(holdErr.message);

  revalidateTag(`hh:${hid}:transactions`);
  revalidateTag(`hh:${hid}:investment-accounts`);
}

export async function deleteInvestmentTransactions(ids: string[]) {
  const { household } = await requireSession();
  const hid = household.household_id;
  if (ids.length === 0) return;
  const sb = getSupabaseServer();

  const { data: invTxns, error: fetchErr } = await sb
    .from("investment_transactions")
    .select("id, account_id, linked_transaction_id")
    .eq("household_id", hid)
    .in("id", ids);
  if (fetchErr) throw new Error(fetchErr.message);

  const accountIds = Array.from(
    new Set((invTxns ?? []).map((t) => t.account_id).filter(Boolean) as string[])
  );
  const linkedIds = (invTxns ?? [])
    .map((t) => t.linked_transaction_id)
    .filter(Boolean) as string[];

  const { error: invErr } = await sb
    .from("investment_transactions")
    .delete()
    .eq("household_id", hid)
    .in("id", ids);
  if (invErr) throw new Error(invErr.message);

  if (linkedIds.length > 0) {
    const { error: cashErr } = await sb
      .from("transactions")
      .delete()
      .eq("household_id", hid)
      .in("id", linkedIds);
    if (cashErr) throw new Error(cashErr.message);
  }

  for (const accountId of accountIds) {
    const { error: holdErr } = await sb
      .from("investment_holdings")
      .delete()
      .eq("household_id", hid)
      .eq("account_id", accountId);
    if (holdErr) throw new Error(holdErr.message);
    await recalculateHoldingsFromTrades(accountId);
  }

  revalidateTag(`hh:${hid}:transactions`);
  revalidateTag(`hh:${hid}:investment-accounts`);
}

export async function deleteAccount(id: string) {
  const { household } = await requireSession();
  const hid = household.household_id;
  const sb = getSupabaseServer();
  const { error } = await sb
    .from("investment_accounts")
    .delete()
    .eq("household_id", hid)
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidateTag(`hh:${hid}:investment-accounts`);
  revalidateTag(`hh:${hid}:transactions`);
}
