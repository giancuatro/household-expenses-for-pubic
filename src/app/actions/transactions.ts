"use server";

import { revalidateTag } from "next/cache";
import { z } from "zod";
import { getSupabaseServer } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth";
import { listTransactionsForMonth } from "@/lib/queries";
import { addMonths, monthKey, todayIso } from "@/lib/format";
import { computeFxAmount } from "@/lib/fx";
import { learnMerchantAlias } from "@/lib/reconcile/merchantAlias";
import type { TxnKind, TransactionRow } from "@/lib/types";

function ymOf(dateIso: string): string {
  return monthKey(new Date(dateIso + "T00:00:00"));
}

const TxnSchema = z.object({
  id: z.string().uuid().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  user_id: z.string().uuid(),
  amount: z.number().int(),
  category_type: z.enum([
    "income", "fixed", "loan", "variable", "personal",
    "transfer_in", "transfer_out", "special", "investment",
  ]),
  category_id: z.string().uuid().nullable().optional(),
  subcategory: z.string().max(200).nullable().optional(),
  note: z.string().max(1000).nullable().optional(),
  is_advance_payment: z.boolean().optional(),
  payment_method_id: z.string().uuid().nullable().optional(),
  /**
   * Phase 7 — Travel mode. When original_currency is set, all four FX columns
   * are persisted together and `amount` is overwritten with
   * round(original_amount * fx_rate) on the server (client estimates are not
   * trusted). The row enters `fx_status='pending'` until the card statement
   * import finalizes it.
   */
  original_amount: z.number().positive().nullable().optional(),
  original_currency: z.string().min(2).max(8).nullable().optional(),
  fx_rate: z.number().positive().nullable().optional(),
  trip_id: z.string().uuid().nullable().optional(),
});

export async function upsertTransaction(input: z.infer<typeof TxnSchema>) {
  const { household } = await requireSession();
  const hid = household.household_id;
  const parsed = TxnSchema.parse(input);
  const sb = getSupabaseServer();

  // Decide whether this is a foreign-currency entry. All three FX inputs
  // must be present together; otherwise we strip them and treat as pure JPY.
  const hasFx =
    !!parsed.original_currency &&
    parsed.original_amount != null &&
    parsed.fx_rate != null;
  if (parsed.original_currency && !hasFx) {
    throw new Error("外貨入力には original_amount と fx_rate が必須です。");
  }

  const finalAmount = hasFx
    ? computeFxAmount(parsed.original_amount as number, parsed.fx_rate as number)
    : parsed.amount;
  if (finalAmount <= 0) throw new Error("金額は1円以上で入力してください。");

  const row: Record<string, unknown> = {
    household_id: hid,
    date: parsed.date,
    user_id: parsed.user_id,
    amount: finalAmount,
    category_type: parsed.category_type as TxnKind,
    category_id: parsed.category_id ?? null,
    subcategory: parsed.subcategory ?? null,
    note: parsed.note ?? null,
    is_advance_payment: parsed.is_advance_payment ?? false,
    payment_method_id: parsed.payment_method_id ?? null,
    source: "manual",
    original_amount: hasFx ? parsed.original_amount : null,
    original_currency: hasFx ? (parsed.original_currency as string).toUpperCase() : null,
    fx_rate: hasFx ? parsed.fx_rate : null,
    fx_status: hasFx ? "pending" : null,
    trip_id: parsed.trip_id ?? null,
  };

  let prevYm: string | null = null;
  if (parsed.id) {
    const { data: prev } = await sb
      .from("transactions")
      .select("date, source_ref")
      .eq("household_id", hid)
      .eq("id", parsed.id)
      .single();
    if (prev?.date) prevYm = ymOf(prev.date);
    const { error } = await sb
      .from("transactions")
      .update(row)
      .eq("household_id", hid)
      .eq("id", parsed.id);
    if (error) throw new Error(error.message);

    // Re-learn when the user recategorizes a card-import row: their correction
    // is the new ground truth for this merchant on the next import. source_ref
    // survives edits (it's not in the update patch), so it stays a reliable
    // card-import signal even after `source` flips to "manual".
    const srcRef = (prev as { source_ref?: string | null } | null)?.source_ref ?? null;
    if (srcRef?.startsWith("card:") && parsed.note) {
      await learnMerchantAlias(sb, hid, parsed.note, {
        user_id: parsed.user_id,
        category_type: parsed.category_type as TxnKind,
        category_id: parsed.category_id ?? null,
      });
    }
  } else {
    const { error } = await sb.from("transactions").insert(row);
    if (error) throw new Error(error.message);
  }

  const ym = ymOf(parsed.date);
  revalidateTag(`hh:${hid}:txn:${ym}`);
  if (prevYm && prevYm !== ym) revalidateTag(`hh:${hid}:txn:${prevYm}`);
  revalidateTag(`hh:${hid}:transactions`);
}

export async function deleteTransaction(id: string) {
  const { household } = await requireSession();
  const hid = household.household_id;
  const sb = getSupabaseServer();
  const { data: prev } = await sb
    .from("transactions")
    .select("date")
    .eq("household_id", hid)
    .eq("id", id)
    .single();
  const { error } = await sb
    .from("transactions")
    .delete()
    .eq("household_id", hid)
    .eq("id", id);
  if (error) throw new Error(error.message);

  if (prev?.date) revalidateTag(`hh:${hid}:txn:${ymOf(prev.date)}`);
  revalidateTag(`hh:${hid}:transactions`);
}

export async function listUnsettledAdvances(): Promise<TransactionRow[]> {
  const { household } = await requireSession();
  const hid = household.household_id;
  const sb = getSupabaseServer();
  const { data, error } = await sb
    .from("transactions")
    .select("*")
    .eq("household_id", hid)
    .eq("is_advance_payment", true)
    .eq("advance_settled", false)
    .order("date", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return (data ?? []) as TransactionRow[];
}

export async function getTransactionsForMonth(ym: string): Promise<TransactionRow[]> {
  const { household } = await requireSession();
  if (!/^\d{4}-\d{2}$/.test(ym)) throw new Error("Invalid month format");
  return listTransactionsForMonth(household.household_id, ym);
}

/**
 * Free-text search over note / subcategory, bounded to the last 24 months so
 * the scan stays cheap as history grows. Case-insensitive ILIKE; user input is
 * stripped of characters that would break the PostgREST or() filter grammar.
 */
export async function searchTransactions(query: string): Promise<TransactionRow[]> {
  const { household } = await requireSession();
  const hid = household.household_id;
  const safe = query.trim().replace(/[,()%_\\]/g, " ").trim();
  if (!safe) return [];
  const pattern = `%${safe}%`;
  const since = `${addMonths(monthKey(), -24)}-01`;
  const sb = getSupabaseServer();
  const { data, error } = await sb
    .from("transactions")
    .select("*")
    .eq("household_id", hid)
    .gte("date", since)
    .or(`note.ilike.${pattern},subcategory.ilike.${pattern}`)
    .order("date", { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  return (data ?? []) as TransactionRow[];
}

/* -------------------- Bulk operations -------------------- */

const BulkUpdateSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(2000),
  patch: z
    .object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      user_id: z.string().uuid().optional(),
      payment_method_id: z.string().uuid().nullable().optional(),
      category_type: z.enum([
        "income", "fixed", "loan", "variable", "personal",
        "transfer_in", "transfer_out", "special", "investment",
      ]).optional(),
      category_id: z.string().uuid().nullable().optional(),
    })
    .refine((p) => Object.keys(p).length > 0, "patch must have at least one field"),
});

export async function bulkUpdateTransactions(input: z.infer<typeof BulkUpdateSchema>) {
  const { household } = await requireSession();
  const hid = household.household_id;
  const { ids, patch } = BulkUpdateSchema.parse(input);
  const sb = getSupabaseServer();

  const { data: prev } = await sb
    .from("transactions")
    .select("date")
    .eq("household_id", hid)
    .in("id", ids);
  const oldYms = new Set<string>();
  for (const r of prev ?? []) if (r?.date) oldYms.add(ymOf(r.date));

  const { error } = await sb
    .from("transactions")
    .update(patch)
    .eq("household_id", hid)
    .in("id", ids);
  if (error) throw new Error(error.message);

  if (patch.date) oldYms.add(ymOf(patch.date));
  for (const ym of oldYms) revalidateTag(`hh:${hid}:txn:${ym}`);
  revalidateTag(`hh:${hid}:transactions`);
  return ids.length;
}

const BulkDeleteSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(2000),
});

export async function bulkDeleteTransactions(input: z.infer<typeof BulkDeleteSchema>) {
  const { household } = await requireSession();
  const hid = household.household_id;
  const { ids } = BulkDeleteSchema.parse(input);
  const sb = getSupabaseServer();

  const { data: prev } = await sb
    .from("transactions")
    .select("date")
    .eq("household_id", hid)
    .in("id", ids);
  const yms = new Set<string>();
  for (const r of prev ?? []) if (r?.date) yms.add(ymOf(r.date));

  const { error } = await sb
    .from("transactions")
    .delete()
    .eq("household_id", hid)
    .in("id", ids);
  if (error) throw new Error(error.message);

  for (const ym of yms) revalidateTag(`hh:${hid}:txn:${ym}`);
  revalidateTag(`hh:${hid}:transactions`);
  return ids.length;
}

export async function toggleAdvanceSettled(
  id: string,
  settled: boolean,
  settledAt?: string | null,
) {
  const { household } = await requireSession();
  const hid = household.household_id;
  const sb = getSupabaseServer();
  const { data: prev } = await sb
    .from("transactions")
    .select("date")
    .eq("household_id", hid)
    .eq("id", id)
    .single();
  const settled_at = settled
    ? (settledAt && /^\d{4}-\d{2}-\d{2}$/.test(settledAt) ? settledAt : todayIso())
    : null;
  const { error } = await sb
    .from("transactions")
    .update({ advance_settled: settled, advance_settled_at: settled_at })
    .eq("household_id", hid)
    .eq("id", id);
  if (error) throw new Error(error.message);

  if (prev?.date) revalidateTag(`hh:${hid}:txn:${ymOf(prev.date)}`);
  revalidateTag(`hh:${hid}:transactions`);
}

/* -------------------- FX settlement (travel mode) -------------------- */

const FxSettleSchema = z
  .object({
    id: z.string().uuid(),
    fxRate: z.number().positive().max(100_000).optional(),
    jpyAmount: z.number().int().positive().optional(),
  })
  .refine(
    (v) => v.fxRate !== undefined || v.jpyAmount !== undefined,
    "fxRate か jpyAmount のどちらかを指定してください。",
  );

/**
 * Finalize a pending FX transaction. The user provides EITHER the real
 * fx_rate (preferred when they read it off a statement) OR the real JPY
 * amount (preferred when the statement only shows the converted total).
 * The other field is back-computed so both columns stay consistent.
 */
export async function settleTransactionFx(input: z.infer<typeof FxSettleSchema>) {
  const { household } = await requireSession();
  const hid = household.household_id;
  const parsed = FxSettleSchema.parse(input);
  const sb = getSupabaseServer();

  const { data: row } = await sb
    .from("transactions")
    .select("date, original_amount, original_currency, fx_status")
    .eq("household_id", hid)
    .eq("id", parsed.id)
    .single();
  if (!row) throw new Error("取引が見つかりません。");
  if (!row.original_amount || !row.original_currency) {
    throw new Error("この取引は外貨情報を持っていません。");
  }

  let jpy: number;
  let rate: number;
  if (parsed.jpyAmount !== undefined) {
    jpy = parsed.jpyAmount;
    rate = parsed.jpyAmount / (row.original_amount as number);
  } else {
    rate = parsed.fxRate as number;
    jpy = Math.max(1, Math.round((row.original_amount as number) * rate));
  }

  const { error } = await sb
    .from("transactions")
    .update({ amount: jpy, fx_rate: rate, fx_status: "finalized" })
    .eq("household_id", hid)
    .eq("id", parsed.id);
  if (error) throw new Error(error.message);

  revalidateTag(`hh:${hid}:txn:${ymOf(row.date as string)}`);
  revalidateTag(`hh:${hid}:transactions`);
}

/* -------------------- Split (group bill) creation -------------------- */
const SplitTxnSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  user_id: z.string().uuid(),
  our_amount: z.number().int().positive(),
  advance_amount: z.number().int().positive(),
  category_type: z.enum([
    "income", "fixed", "loan", "variable", "personal",
    "transfer_in", "transfer_out", "special", "investment",
  ]),
  category_id: z.string().uuid().nullable().optional(),
  note: z.string().max(1000).nullable().optional(),
  payment_method_id: z.string().uuid().nullable().optional(),
});

export async function createSplitTransaction(input: z.infer<typeof SplitTxnSchema>) {
  const { household } = await requireSession();
  const hid = household.household_id;
  const parsed = SplitTxnSchema.parse(input);
  const sb = getSupabaseServer();

  const groupId =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const splitRef = `split:${groupId}`;

  const baseRow = {
    household_id: hid,
    date: parsed.date,
    user_id: parsed.user_id,
    category_type: parsed.category_type as TxnKind,
    category_id: parsed.category_id ?? null,
    payment_method_id: parsed.payment_method_id ?? null,
    source: "manual",
  };

  const noteOurs = parsed.note ?? null;
  const noteAdv = parsed.note ? `${parsed.note}（立替分）` : "立替分";

  const { error } = await sb.from("transactions").insert([
    {
      ...baseRow,
      amount: parsed.our_amount,
      is_advance_payment: false,
      note: noteOurs,
      source_ref: `${splitRef}:ours`,
    },
    {
      ...baseRow,
      amount: parsed.advance_amount,
      is_advance_payment: true,
      note: noteAdv,
      source_ref: `${splitRef}:adv`,
    },
  ]);
  if (error) throw new Error(error.message);

  revalidateTag(`hh:${hid}:txn:${ymOf(parsed.date)}`);
  revalidateTag(`hh:${hid}:transactions`);
}
