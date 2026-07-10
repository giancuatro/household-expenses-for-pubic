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

/**
 * Insert the cash-side transaction + the investment_transactions row for one
 * trade. Does NOT recalculate holdings or revalidate — callers decide when to
 * do that (once, at the end of a batch). Assumes `hid` is already resolved and
 * `p` is validated.
 */
async function insertTradeRow(
  sb: ReturnType<typeof getSupabaseServer>,
  hid: string,
  p: z.infer<typeof TradeSchema>,
) {
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
}

export async function recordTrade(input: z.infer<typeof TradeSchema>) {
  const { household } = await requireSession();
  const hid = household.household_id;
  const p = TradeSchema.parse(input);
  const sb = getSupabaseServer();

  await insertTradeRow(sb, hid, p);

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

/**
 * Build the dedup key for an investment trade. Two trades with the same key
 * are considered the same event and one of them should be skipped on import.
 *
 * Tolerance: quantity rounded to 4 decimals (broker exports keep 4–6 digits
 * but rounding noise between exports is real), price to 2 decimals (cents /
 * 銭). Action and ticker are case-insensitive. Account scopes the key so two
 * accounts can independently hold "AAPL 2026-04-01 buy 10 @150".
 */
function tradeDedupKey(t: {
  account_id?: string | null;
  date: string;
  ticker: string;
  action: "buy" | "sell";
  quantity: number;
  price_usd: number;
}): string {
  const acct = t.account_id ?? "";
  return [
    acct,
    t.date,
    t.ticker.toUpperCase(),
    t.action,
    t.quantity.toFixed(4),
    t.price_usd.toFixed(2),
  ].join("|");
}

export async function bulkRecordTrades(rows: z.infer<typeof BulkTradeRow>[]) {
  const { household } = await requireSession();
  const hid = household.household_id;
  const results: { ok: number; skipped: number; errors: string[] } = {
    ok: 0,
    skipped: 0,
    errors: [],
  };
  const sb = getSupabaseServer();

  // Pre-load every existing trade for the relevant accounts so we can skip
  // duplicates without round-tripping per row. Re-importing the same broker
  // CSV after adding a few new trades is the common case — we want to keep
  // the user's new rows and silently skip the rest, not raise unique-key
  // errors and abort the batch.
  const accountIds = Array.from(
    new Set(rows.map((r) => r.account_id).filter((x): x is string => !!x)),
  );
  const existingKeys = new Set<string>();
  if (accountIds.length > 0) {
    const { data: existing } = await sb
      .from("investment_transactions")
      .select("account_id, date, ticker, action, quantity, price_usd")
      .eq("household_id", hid)
      .in("account_id", accountIds);
    for (const t of (existing ?? []) as Array<{
      account_id: string | null;
      date: string;
      ticker: string;
      action: "buy" | "sell";
      quantity: number;
      price_usd: number;
    }>) {
      existingKeys.add(tradeDedupKey(t));
    }
  }

  // De-dup within the import batch itself too — broker CSVs sometimes repeat
  // a settled trade across multiple downloaded months.
  const seenInBatch = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    try {
      const parsed = BulkTradeRow.parse(rows[i]);
      const key = tradeDedupKey(parsed);
      if (existingKeys.has(key) || seenInBatch.has(key)) {
        results.skipped++;
        continue;
      }
      seenInBatch.add(key);
      // Insert only; holdings are recalculated once after the batch (below),
      // not per row — otherwise an N-row import is O(N²) recalcs.
      await insertTradeRow(sb, hid, parsed);
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
  revalidateTag(`hh:${hid}:investment-accounts`);
  return results;
}

/* ---------------------------------------------------------------------- */
/*  updateTrade — edit an existing investment_transactions row             */
/*                                                                         */
/*  Keeps the linked cash-side row in sync (amount, date, subcategory).    */
/*  After updating, recalculates the holdings snapshot for the account so   */
/*  the trade-history → holdings invariant stays intact.                   */
/* ---------------------------------------------------------------------- */

const UpdateTradeSchema = z.object({
  id: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  account_id: z.string().uuid().nullable().optional(),
  ticker: z.string().min(1).max(20),
  name: z.string().max(120).nullable().optional(),
  action: z.enum(["buy", "sell"]),
  quantity: z.number().positive(),
  price_usd: z.number().nonnegative(),
  exchange_rate: z.number().positive(),
  note: z.string().max(400).nullable().optional(),
});

/**
 * Edit an existing investment_transactions row.
 *
 * When account_id changes we have to recalculate the holdings snapshot for
 * BOTH the old and the new account — buying 10 AAPL in account A and then
 * moving the trade record to account B means A loses 10 AAPL and B gains
 * them. recalculateHoldingsFromTrades is idempotent, so calling it on both
 * is safe even if account_id didn't change.
 */
export async function updateTrade(input: z.infer<typeof UpdateTradeSchema>) {
  const { household } = await requireSession();
  const hid = household.household_id;
  const p = UpdateTradeSchema.parse(input);
  const sb = getSupabaseServer();

  const { data: prev, error: fetchErr } = await sb
    .from("investment_transactions")
    .select("id, account_id, linked_transaction_id")
    .eq("household_id", hid)
    .eq("id", p.id)
    .single();
  if (fetchErr || !prev) throw new Error("取引が見つかりません。");

  // Confirm the new account belongs to this household (RLS would catch a
  // mismatch via the FK, but a clean error message is friendlier).
  if (p.account_id) {
    const { data: acct } = await sb
      .from("investment_accounts")
      .select("id")
      .eq("household_id", hid)
      .eq("id", p.account_id)
      .maybeSingle();
    if (!acct) throw new Error("指定された証券口座がこの世帯に存在しません。");
  }

  const priceUnit = getPriceUnit(p.ticker);
  const amountJpy = Math.round((p.quantity * p.price_usd) / priceUnit * p.exchange_rate);

  const { error: updErr } = await sb
    .from("investment_transactions")
    .update({
      date: p.date,
      account_id: p.account_id ?? null,
      ticker: p.ticker,
      name: p.name ?? null,
      action: p.action,
      quantity: p.quantity,
      price_usd: p.price_usd,
      exchange_rate: p.exchange_rate,
      amount_jpy: amountJpy,
      note: p.note ?? null,
    })
    .eq("household_id", hid)
    .eq("id", p.id);
  if (updErr) throw new Error(updErr.message);

  if (prev.linked_transaction_id) {
    const { error: linkedErr } = await sb
      .from("transactions")
      .update({
        date: p.date,
        amount: amountJpy,
        category_type: p.action === "buy" ? "investment" : "income",
        subcategory: `${p.action === "buy" ? "投資購入" : "投資売却"} ${p.ticker}`,
        note: p.note ?? null,
      })
      .eq("household_id", hid)
      .eq("id", prev.linked_transaction_id);
    if (linkedErr) throw new Error(`連動取引の更新に失敗: ${linkedErr.message}`);
  }

  const accountsToRebuild = new Set<string>();
  if (prev.account_id) accountsToRebuild.add(prev.account_id as string);
  if (p.account_id) accountsToRebuild.add(p.account_id);
  for (const accountId of accountsToRebuild) {
    await recalculateHoldingsFromTrades(accountId);
  }

  revalidateTag(`hh:${hid}:transactions`);
  revalidateTag(`hh:${hid}:investment-accounts`);
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
