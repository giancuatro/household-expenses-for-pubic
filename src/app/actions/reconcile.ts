"use server";

import { revalidateTag } from "next/cache";
import { z } from "zod";
import { createHash, randomUUID } from "crypto";
import { getSupabaseServer } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth";
import {
  computePdfFingerprint,
  decodeCsvBytes,
  detectParser,
  extractPdfText,
  looksLikePdf,
  pickBestPdfStrategy,
  runPdfStrategy,
  type PdfStrategyId,
} from "@/lib/csvImport";
import { findGroupMatches, reconcile, statusFromConfidence, type CandidateTxn, type CardRow } from "@/lib/reconcile/matcher";
import { monthKey } from "@/lib/format";
import { isPlausibleRate } from "@/lib/currencyList";
import type { TxnKind } from "@/lib/types";

/* ---------------------------------------------------------------------- */
/*  Constants                                                              */
/* ---------------------------------------------------------------------- */

const MAX_FILE_BYTES = 8 * 1024 * 1024;        // 8 MB (PDF statements are larger than CSVs)

/* ---------------------------------------------------------------------- */
/*  importCardStatement                                                    */
/* ---------------------------------------------------------------------- */

const ImportSchema = z.object({
  payment_method_id: z.string().uuid(),
  filename: z.string().max(255).optional(),
  fileBase64: z.string().max(MAX_FILE_BYTES * 2),  // base64 expands ~33%
});

export type ImportInput = z.infer<typeof ImportSchema>;

export interface ImportResult {
  importId: string;
  rowCount: number;
  skippedCount: number;
  duplicate: boolean;       // true when raw_hash already exists for this household
  periodStart: string | null;
  periodEnd: string | null;
  /** True when the PDF format matched a previously-remembered fingerprint. */
  formatRemembered?: boolean;
  /** The PDF strategy used ('compact', 'split-col', ...) — null for CSV imports. */
  pdfStrategy?: string | null;
}

/**
 * Parse + persist a card statement CSV. Idempotent on (household_id, raw_hash).
 *
 * The matcher runs synchronously after persistence so the user is taken
 * straight to a populated reconcile UI.
 */
export async function importCardStatement(input: ImportInput): Promise<ImportResult> {
  const { user, household } = await requireSession();
  const hid = household.household_id;
  const parsed = ImportSchema.parse(input);
  const sb = getSupabaseServer();

  // Confirm payment_method belongs to this household. RLS would block a
  // mismatch anyway, but we want a clean error rather than a constraint
  // violation downstream.
  const { data: pm, error: pmErr } = await sb
    .from("payment_methods")
    .select("id, household_id")
    .eq("household_id", hid)
    .eq("id", parsed.payment_method_id)
    .single();
  if (pmErr || !pm) throw new Error("指定された支払い方法が見つかりません。");

  const buf = Buffer.from(parsed.fileBase64, "base64");
  if (buf.length === 0) throw new Error("ファイルが空です。");
  if (buf.length > MAX_FILE_BYTES) throw new Error("ファイルサイズが上限（8MB）を超えています。");

  const rawHash = createHash("sha256").update(buf).digest("hex");

  // Dedupe: same household + same file → return the existing import id.
  const { data: existing } = await sb
    .from("card_statement_imports")
    .select("id, row_count, period_start, period_end")
    .eq("household_id", hid)
    .eq("raw_hash", rawHash)
    .maybeSingle();
  if (existing) {
    return {
      importId: existing.id as string,
      rowCount: (existing.row_count as number) ?? 0,
      skippedCount: 0,
      duplicate: true,
      periodStart: (existing.period_start as string) ?? null,
      periodEnd: (existing.period_end as string) ?? null,
    };
  }

  // Auto-detect file format from magic bytes. PDFs additionally have an
  // internal strategy (compact / split-col / ...) — for those we look the
  // fingerprint up in card_pdf_format_memory and skip the strategy trial
  // when we've successfully parsed this card's PDF before.
  const bytes = new Uint8Array(buf);
  const isPdf = looksLikePdf(bytes);
  let result;
  let pdfStrategy: PdfStrategyId | null = null;
  let formatRemembered = false;

  if (isPdf) {
    const body = await extractPdfText(bytes);
    const fingerprint = computePdfFingerprint(body);
    const { data: memory } = await sb
      .from("card_pdf_format_memory")
      .select("parser_strategy, hit_count")
      .eq("household_id", hid)
      .eq("fingerprint", fingerprint)
      .maybeSingle();

    if (memory?.parser_strategy) {
      // Known format → run only the remembered strategy.
      const stored = memory.parser_strategy as PdfStrategyId;
      try {
        result = runPdfStrategy(body, stored);
        if (result.rows.length === 0) {
          // The remembered strategy regressed (rare — issuer changed PDF
          // layout?). Fall back to re-detection so the user still gets a
          // useful import.
          throw new Error("remembered strategy produced no rows");
        }
        pdfStrategy = stored;
        formatRemembered = true;
        await sb
          .from("card_pdf_format_memory")
          .update({
            hit_count: (memory.hit_count as number) + 1,
            last_used_at: new Date().toISOString(),
          })
          .eq("household_id", hid)
          .eq("fingerprint", fingerprint);
      } catch {
        const best = pickBestPdfStrategy(body);
        result = best.result;
        pdfStrategy = best.strategy;
        await sb
          .from("card_pdf_format_memory")
          .update({
            parser_strategy: best.strategy,
            hit_count: 1,
            last_used_at: new Date().toISOString(),
            first_seen_at: new Date().toISOString(),
          })
          .eq("household_id", hid)
          .eq("fingerprint", fingerprint);
      }
    } else {
      // First time seeing this card — trial every strategy and persist the
      // winner so the next import is a direct hit.
      const best = pickBestPdfStrategy(body);
      result = best.result;
      pdfStrategy = best.strategy;
      await sb.from("card_pdf_format_memory").insert({
        household_id: hid,
        fingerprint,
        parser_strategy: best.strategy,
      });
    }
  } else {
    const parser = detectParser(bytes);
    const body = decodeCsvBytes(bytes);
    result = parser.parse(body);
  }

  // Persist the import header.
  const importId = randomUUID();
  // Parser column on card_statement_imports records which extraction
  // pipeline produced the rows: for PDFs we record the strategy id
  // ("compact" / "split-col"); for CSVs we keep the existing parser id.
  const importParserLabel = isPdf
    ? `pdf-${pdfStrategy ?? "auto"}`
    : detectParser(bytes).id;
  const { error: hdrErr } = await sb.from("card_statement_imports").insert({
    id: importId,
    household_id: hid,
    payment_method_id: parsed.payment_method_id,
    parser: importParserLabel,
    source_filename: parsed.filename ?? null,
    source_size_bytes: buf.length,
    raw_hash: rawHash,
    period_start: result.periodStart,
    period_end: result.periodEnd,
    row_count: result.rows.length,
    imported_by: user.id,
  });
  if (hdrErr) throw new Error(`インポート記録の保存に失敗: ${hdrErr.message}`);

  // Insert staging rows in chunks of 500 to stay well under PostgREST limits.
  const stagingRows = result.rows.map((r) => ({
    id: randomUUID(),
    import_id: importId,
    household_id: hid,
    raw_date: r.raw.date,
    raw_amount: r.raw.amount,
    raw_merchant: r.raw.merchant,
    date: r.date,
    amount: r.amount,
    merchant: r.merchant,
    cardholder: r.cardholder ?? null,
    status: "unmatched",
  }));
  for (let i = 0; i < stagingRows.length; i += 500) {
    const chunk = stagingRows.slice(i, i + 500);
    const { error } = await sb.from("staging_card_transactions").insert(chunk);
    if (error) throw new Error(`明細行の保存に失敗: ${error.message}`);
  }

  // Run the matcher right away so the UI lands on a populated view.
  await runMatcher(importId);

  revalidateTag(`hh:${hid}:reconcile`);
  return {
    importId,
    rowCount: result.rows.length,
    skippedCount: result.skipped.length,
    duplicate: false,
    periodStart: result.periodStart,
    periodEnd: result.periodEnd,
    formatRemembered,
    pdfStrategy,
  };
}

/* ---------------------------------------------------------------------- */
/*  runMatcher                                                             */
/* ---------------------------------------------------------------------- */

/**
 * Compute matches for every staging row in this import that hasn't been
 * touched by the user yet (status in 'unmatched','suggested'). Confirmed,
 * created, and ignored rows are left alone — once the user has acted, we
 * never silently re-categorize.
 *
 * Auto-confirm only fires at confidence 100 (per user setting).
 */
export async function runMatcher(importId: string): Promise<{ updated: number }> {
  const { household } = await requireSession();
  const hid = household.household_id;
  const sb = getSupabaseServer();

  const { data: imp, error: impErr } = await sb
    .from("card_statement_imports")
    .select("id, household_id, payment_method_id, period_start, period_end")
    .eq("household_id", hid)
    .eq("id", importId)
    .single();
  if (impErr || !imp) throw new Error("インポートが見つかりません。");

  const { data: stagingRaw } = await sb
    .from("staging_card_transactions")
    .select("id, date, amount, merchant, status")
    .eq("household_id", hid)
    .eq("import_id", importId)
    .in("status", ["unmatched", "suggested"]);
  const staging = (stagingRaw ?? []) as Array<{ id: string; date: string; amount: number; merchant: string | null; status: string }>;
  if (staging.length === 0) return { updated: 0 };

  // Pull candidate transactions for this payment method, widened by a week
  // either side of the statement period.
  const minDate = (imp.period_start as string | null) ?? staging.reduce((a, r) => (r.date < a ? r.date : a), staging[0].date);
  const maxDate = (imp.period_end as string | null) ?? staging.reduce((a, r) => (r.date > a ? r.date : a), staging[0].date);
  const widenedMin = shiftDays(minDate, -7);
  const widenedMax = shiftDays(maxDate, 7);

  const { data: txnRaw } = await sb
    .from("transactions")
    .select("id, date, amount, note, statement_row_id")
    .eq("household_id", hid)
    .eq("payment_method_id", imp.payment_method_id)
    .gte("date", widenedMin)
    .lte("date", widenedMax);
  const candidates: CandidateTxn[] = ((txnRaw ?? []) as Array<{ id: string; date: string; amount: number; note: string | null; statement_row_id: string | null }>)
    // Skip transactions already linked to a staging row from a prior import —
    // double-claiming would silently overwrite history.
    .filter((t) => !t.statement_row_id)
    .map((t) => ({ id: t.id, date: t.date, amount: t.amount, note: t.note }));

  const cardRows: CardRow[] = staging.map((r) => ({
    id: r.id,
    date: r.date,
    amount: r.amount,
    merchant: r.merchant,
  }));

  const verdicts = reconcile(cardRows, candidates);

  // ─── Pass 1: persist single-row verdicts. ────────────────────────────
  // Track which card rows and which transactions stay unclaimed after this
  // pass so the group matcher can take a swing at them.
  const claimedCards = new Set<string>();
  const claimedTxns = new Set<string>();
  let updated = 0;
  for (const v of verdicts) {
    const status = statusFromConfidence(v.confidence);
    const { error } = await sb
      .from("staging_card_transactions")
      .update({
        matched_transaction_id: v.matchedTxnId,
        match_confidence: v.confidence,
        status,
        match_group_id: null,            // ← ungroup any prior group hit
      })
      .eq("household_id", hid)
      .eq("id", v.cardRowId);
    if (error) throw new Error(`マッチ結果の保存に失敗: ${error.message}`);
    if (status === "confirmed" && v.matchedTxnId) {
      // Stamp the transaction so re-runs don't re-match it.
      await sb
        .from("transactions")
        .update({ statement_row_id: v.cardRowId })
        .eq("household_id", hid)
        .eq("id", v.matchedTxnId);
      claimedCards.add(v.cardRowId);
      claimedTxns.add(v.matchedTxnId);
    } else if (v.matchedTxnId) {
      // 'suggested' rows reserve their pairing too, so the group matcher
      // doesn't propose a conflicting subset.
      claimedCards.add(v.cardRowId);
      claimedTxns.add(v.matchedTxnId);
    }
    updated++;
  }

  // ─── Pass 1.5: foreign-currency (pending FX) matching. ──────────────
  // The exact-amount Pass 1 can never match a pending FX row because its JPY
  // amount is just an estimate. Here we look up unclaimed card rows against
  // pending FX transactions on the same payment method within a ±5 day
  // window, scoring by "is this implied rate plausible for the currency".
  // Confidence is capped at 90 so it always lands as a suggestion (and the
  // user accepts via the bulk button or per-row).
  const remainingAfterPass1 = cardRows.filter((r) => !claimedCards.has(r.id));
  if (remainingAfterPass1.length > 0) {
    const { data: fxRaw } = await sb
      .from("transactions")
      .select("id, date, original_amount, original_currency, statement_row_id, trip_id")
      .eq("household_id", hid)
      .eq("payment_method_id", imp.payment_method_id)
      .eq("fx_status", "pending")
      .gte("date", shiftDays(widenedMin, -5))
      .lte("date", shiftDays(widenedMax, 5));
    const fxCandidates = ((fxRaw ?? []) as Array<{
      id: string;
      date: string;
      original_amount: number | null;
      original_currency: string | null;
      statement_row_id: string | null;
      trip_id: string | null;
    }>).filter((t) => !t.statement_row_id && !claimedTxns.has(t.id));

    // Pre-load trip est_rates so isPlausibleRate can widen for exotic currencies.
    const tripIds = Array.from(new Set(fxCandidates.map((t) => t.trip_id).filter(Boolean) as string[]));
    const tripRateById = new Map<string, number>();
    if (tripIds.length > 0) {
      const { data: trips } = await sb
        .from("trips")
        .select("id, est_rate")
        .eq("household_id", hid)
        .in("id", tripIds);
      for (const t of (trips ?? []) as Array<{ id: string; est_rate: number }>) {
        tripRateById.set(t.id, t.est_rate as number);
      }
    }

    // Score every (card × fx-candidate) pair, then greedy-assign best first.
    type FxPair = { cardId: string; txnId: string; score: number };
    const fxPairs: FxPair[] = [];
    for (const c of remainingAfterPass1) {
      for (const t of fxCandidates) {
        if (!t.original_amount || !t.original_currency) continue;
        const tripRate = t.trip_id ? tripRateById.get(t.trip_id) : undefined;
        if (!isPlausibleRate(c.amount, t.original_amount, t.original_currency, tripRate)) continue;
        const days = Math.abs(
          (Date.parse(c.date + "T00:00:00Z") - Date.parse(t.date + "T00:00:00Z")) / 86_400_000,
        );
        if (days > 5) continue;
        // Base 90, drop a point per day so closer pairs win ties.
        fxPairs.push({ cardId: c.id, txnId: t.id, score: Math.max(70, 90 - days) });
      }
    }
    fxPairs.sort((a, b) => b.score - a.score);

    for (const p of fxPairs) {
      if (claimedCards.has(p.cardId) || claimedTxns.has(p.txnId)) continue;
      const { error } = await sb
        .from("staging_card_transactions")
        .update({
          matched_transaction_id: p.txnId,
          match_confidence: p.score,
          status: "suggested",
          match_group_id: null,
        })
        .eq("household_id", hid)
        .eq("id", p.cardId);
      if (error) throw new Error(`FX マッチの保存に失敗: ${error.message}`);
      claimedCards.add(p.cardId);
      claimedTxns.add(p.txnId);
      updated++;
    }
  }

  // ─── Pass 2: group matching (1 transaction = N card rows). ──────────
  // Typical case: user enters one ¥5,000 Amazon row but the card splits
  // it into several smaller charges. The 1:1 matcher misses these; we
  // sweep up the leftovers here.
  const remainingCards = cardRows.filter((r) => !claimedCards.has(r.id));
  const remainingTxns = candidates.filter((t) => !claimedTxns.has(t.id));
  const groupProposals = findGroupMatches(remainingCards, remainingTxns);

  for (const g of groupProposals) {
    const groupId = randomUUID();
    for (const cardId of g.cardRowIds) {
      const { error } = await sb
        .from("staging_card_transactions")
        .update({
          matched_transaction_id: g.matchedTxnId,
          match_confidence: g.confidence,
          // Group matches are always suggestions — never auto-confirmed
          // (their max confidence is 85, the auto-confirm threshold is 100).
          status: "suggested",
          match_group_id: groupId,
        })
        .eq("household_id", hid)
        .eq("id", cardId);
      if (error) throw new Error(`グループマッチの保存に失敗: ${error.message}`);
      updated++;
    }
  }

  revalidateTag(`hh:${hid}:reconcile`);
  return { updated };
}

function shiftDays(iso: string, delta: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/* ---------------------------------------------------------------------- */
/*  acceptMatch / rejectMatch / ignoreCardRow                              */
/*                                                                         */
/*  All three operate on a *match unit*: either a single staging row, or  */
/*  every sibling sharing a `match_group_id`. The user clicks once on any  */
/*  group member and the whole group flips together — the alternative      */
/*  (per-row toggling) would corrupt the 1-txn-vs-N-rows invariant.        */
/* ---------------------------------------------------------------------- */

const RowIdSchema = z.object({ stagingId: z.string().uuid() });

/** Resolve the set of staging IDs that should move atomically with this one. */
async function resolveSiblingIds(
  sb: ReturnType<typeof getSupabaseServer>,
  hid: string,
  stagingId: string,
): Promise<{
  ids: string[];
  matchedTxnId: string | null;
  groupId: string | null;
  importId: string;
}> {
  const { data: row } = await sb
    .from("staging_card_transactions")
    .select("id, matched_transaction_id, match_group_id, import_id")
    .eq("household_id", hid)
    .eq("id", stagingId)
    .single();
  if (!row) throw new Error("明細行が見つかりません。");
  const groupId = (row.match_group_id as string | null) ?? null;
  const matchedTxnId = (row.matched_transaction_id as string | null) ?? null;
  const importId = row.import_id as string;
  if (!groupId) return { ids: [stagingId], matchedTxnId, groupId: null, importId };
  const { data: siblings } = await sb
    .from("staging_card_transactions")
    .select("id")
    .eq("household_id", hid)
    .eq("match_group_id", groupId);
  const ids = ((siblings ?? []) as Array<{ id: string }>).map((r) => r.id);
  return { ids: ids.length > 0 ? ids : [stagingId], matchedTxnId, groupId, importId };
}

/**
 * Auto-cleanup: when every staging row in an import is in a terminal state
 * (confirmed / created / ignored), delete the import header. Cascade removes
 * the staging rows; transactions keep their data, only their statement_row_id
 * back-pointer is nulled out via the FK's ON DELETE SET NULL. The user's
 * stated requirement is "once manual reconciliation is done, drop the file
 * from the DB" — this is that hook.
 */
async function maybeAutoDeleteImport(
  sb: ReturnType<typeof getSupabaseServer>,
  hid: string,
  importId: string,
): Promise<boolean> {
  const { count, error } = await sb
    .from("staging_card_transactions")
    .select("id", { count: "exact", head: true })
    .eq("household_id", hid)
    .eq("import_id", importId)
    .in("status", ["unmatched", "suggested"]);
  if (error) return false;
  if ((count ?? 0) > 0) return false;
  const { error: delErr } = await sb
    .from("card_statement_imports")
    .delete()
    .eq("household_id", hid)
    .eq("id", importId);
  if (delErr) return false;
  return true;
}

export async function acceptMatch(input: z.infer<typeof RowIdSchema>): Promise<{ importDeleted: boolean }> {
  const { household } = await requireSession();
  const hid = household.household_id;
  const { stagingId } = RowIdSchema.parse(input);
  const sb = getSupabaseServer();

  const { ids, matchedTxnId, importId } = await resolveSiblingIds(sb, hid, stagingId);
  if (!matchedTxnId) throw new Error("候補が紐付いていない行です。");

  const { error } = await sb
    .from("staging_card_transactions")
    .update({ status: "confirmed" })
    .eq("household_id", hid)
    .in("id", ids);
  if (error) throw new Error(error.message);

  // Stamp the transaction with one of the group members. statement_row_id is
  // a single-FK pointer; the canonical "this txn was reconciled" check is
  // "any staging row's matched_transaction_id equals this txn", not the
  // pointer direction. Using the first id is arbitrary but stable.
  await sb
    .from("transactions")
    .update({ statement_row_id: ids[0] })
    .eq("household_id", hid)
    .eq("id", matchedTxnId);

  // Auto-finalize pending FX: copy the card row's JPY into the txn and
  // back-compute the actual fx_rate. The user got this behavior by
  // accepting the suggestion, so we don't need a separate confirmation.
  await finalizeFxIfPending(sb, hid, matchedTxnId, ids[0]);

  const ym = await monthOfTxn(sb, hid, matchedTxnId);
  if (ym) revalidateTag(`hh:${hid}:txn:${ym}`);
  revalidateTag(`hh:${hid}:transactions`);
  const importDeleted = await maybeAutoDeleteImport(sb, hid, importId);
  revalidateTag(`hh:${hid}:reconcile`);
  return { importDeleted };
}

/**
 * If the transaction is in `fx_status='pending'`, overwrite its JPY amount
 * with the matched card row's amount and back-compute the actual fx_rate.
 * No-op otherwise. Idempotent.
 */
async function finalizeFxIfPending(
  sb: ReturnType<typeof getSupabaseServer>,
  hid: string,
  txnId: string,
  stagingId: string,
) {
  const { data: txn } = await sb
    .from("transactions")
    .select("original_amount, fx_status")
    .eq("household_id", hid)
    .eq("id", txnId)
    .single();
  if (!txn || txn.fx_status !== "pending" || !txn.original_amount) return;
  const { data: stage } = await sb
    .from("staging_card_transactions")
    .select("amount")
    .eq("household_id", hid)
    .eq("id", stagingId)
    .single();
  if (!stage) return;
  const jpy = stage.amount as number;
  const rate = jpy / (txn.original_amount as number);
  await sb
    .from("transactions")
    .update({ amount: jpy, fx_rate: rate, fx_status: "finalized" })
    .eq("household_id", hid)
    .eq("id", txnId);
}

async function monthOfTxn(
  sb: ReturnType<typeof getSupabaseServer>,
  hid: string,
  txnId: string,
): Promise<string | null> {
  const { data } = await sb
    .from("transactions")
    .select("date")
    .eq("household_id", hid)
    .eq("id", txnId)
    .single();
  if (!data?.date) return null;
  return monthKey(new Date((data.date as string) + "T00:00:00"));
}

export async function rejectMatch(input: z.infer<typeof RowIdSchema>) {
  const { household } = await requireSession();
  const hid = household.household_id;
  const { stagingId } = RowIdSchema.parse(input);
  const sb = getSupabaseServer();

  const { ids, matchedTxnId } = await resolveSiblingIds(sb, hid, stagingId);

  const { error } = await sb
    .from("staging_card_transactions")
    .update({
      matched_transaction_id: null,
      match_confidence: null,
      match_group_id: null,
      status: "unmatched",
    })
    .eq("household_id", hid)
    .in("id", ids);
  if (error) throw new Error(error.message);

  // Release the transaction's reverse pointer if it was pointing at one of
  // the now-rejected staging rows.
  if (matchedTxnId) {
    await sb
      .from("transactions")
      .update({ statement_row_id: null })
      .eq("household_id", hid)
      .eq("id", matchedTxnId)
      .in("statement_row_id", ids);
  }

  revalidateTag(`hh:${hid}:reconcile`);
}

export async function ignoreCardRow(input: z.infer<typeof RowIdSchema>): Promise<{ importDeleted: boolean }> {
  const { household } = await requireSession();
  const hid = household.household_id;
  const { stagingId } = RowIdSchema.parse(input);
  const sb = getSupabaseServer();

  const { ids, importId } = await resolveSiblingIds(sb, hid, stagingId);
  const { error } = await sb
    .from("staging_card_transactions")
    .update({ status: "ignored" })
    .eq("household_id", hid)
    .in("id", ids);
  if (error) throw new Error(error.message);
  const importDeleted = await maybeAutoDeleteImport(sb, hid, importId);
  revalidateTag(`hh:${hid}:reconcile`);
  return { importDeleted };
}

/* ---------------------------------------------------------------------- */
/*  createTransactionFromCard                                              */
/* ---------------------------------------------------------------------- */

const CreateFromCardSchema = z.object({
  stagingId: z.string().uuid(),
  user_id: z.string().uuid(),
  category_type: z.enum([
    "income", "fixed", "loan", "variable", "personal",
    "transfer_in", "transfer_out", "special", "investment",
  ]),
  category_id: z.string().uuid().nullable().optional(),
  note_override: z.string().max(1000).optional(),
});

export async function createTransactionFromCard(
  input: z.infer<typeof CreateFromCardSchema>,
): Promise<{ transactionId: string; importDeleted: boolean }> {
  const { household } = await requireSession();
  const hid = household.household_id;
  const parsed = CreateFromCardSchema.parse(input);
  const sb = getSupabaseServer();

  const { data: staging } = await sb
    .from("staging_card_transactions")
    .select("id, import_id, date, amount, merchant, status, match_group_id, cardholder")
    .eq("household_id", hid)
    .eq("id", parsed.stagingId)
    .single();
  if (!staging) throw new Error("明細行が見つかりません。");
  if (staging.status === "created" || staging.status === "confirmed") {
    throw new Error("既に取引が紐付いています。");
  }

  // If this row was speculatively bundled into a group suggestion, the user
  // is implicitly rejecting that bundle by creating a stand-alone txn for
  // just this row. Detach the siblings before we proceed so they go back
  // to 'unmatched' rather than dangle with a stale group_id.
  if (staging.match_group_id) {
    await sb
      .from("staging_card_transactions")
      .update({
        matched_transaction_id: null,
        match_confidence: null,
        match_group_id: null,
        status: "unmatched",
      })
      .eq("household_id", hid)
      .eq("match_group_id", staging.match_group_id)
      .neq("id", staging.id);
  }

  const { data: imp } = await sb
    .from("card_statement_imports")
    .select("payment_method_id")
    .eq("household_id", hid)
    .eq("id", staging.import_id)
    .single();
  if (!imp) throw new Error("インポートが見つかりません。");

  const txnId = randomUUID();
  const note = parsed.note_override ?? staging.merchant ?? "";
  const { error: insErr } = await sb.from("transactions").insert({
    id: txnId,
    household_id: hid,
    date: staging.date,
    user_id: parsed.user_id,
    amount: staging.amount,
    category_type: parsed.category_type as TxnKind,
    category_id: parsed.category_id ?? null,
    note: note || null,
    payment_method_id: imp.payment_method_id,
    source: "card-import",
    statement_row_id: staging.id,
  });
  if (insErr) throw new Error(`取引の作成に失敗: ${insErr.message}`);

  const { error: updErr } = await sb
    .from("staging_card_transactions")
    .update({
      matched_transaction_id: txnId,
      status: "created",
      match_confidence: 100,
    })
    .eq("household_id", hid)
    .eq("id", staging.id);
  if (updErr) throw new Error(updErr.message);

  const importDeleted = await maybeAutoDeleteImport(sb, hid, staging.import_id as string);

  // Cache invalidation for the month the new txn lives in.
  const ym = monthKey(new Date(staging.date + "T00:00:00"));
  revalidateTag(`hh:${hid}:txn:${ym}`);
  revalidateTag(`hh:${hid}:transactions`);
  revalidateTag(`hh:${hid}:reconcile`);
  return { transactionId: txnId, importDeleted };
}

/* ---------------------------------------------------------------------- */
/*  archiveImport — hard-deletes the import. Kept under the old name to    */
/*  avoid breaking call sites; the cascade drops staging rows, while       */
/*  transactions.statement_row_id is nulled via ON DELETE SET NULL so any  */
/*  already-confirmed cash-side entries survive.                           */
/* ---------------------------------------------------------------------- */

export async function archiveImport(importId: string) {
  const { household } = await requireSession();
  const hid = household.household_id;
  const sb = getSupabaseServer();
  const { error } = await sb
    .from("card_statement_imports")
    .delete()
    .eq("household_id", hid)
    .eq("id", importId);
  if (error) throw new Error(error.message);
  revalidateTag(`hh:${hid}:reconcile`);
}

/* ---------------------------------------------------------------------- */
/*  bulkAcceptHighConfidence                                               */
/* ---------------------------------------------------------------------- */

/* ---------------------------------------------------------------------- */
/*  bulkCreateFamilyCard                                                   */
/*                                                                         */
/*  Family-card rows in a Japanese card statement are always the spouse's  */
/*  personal expense in this household's convention. Rather than make the  */
/*  user click "+ 家計簿に追加" on every unmatched 家族 row, this batches    */
/*  the creation: every unmatched-and-tagged staging row becomes a         */
/*  transactions row with (user_id=family_default, category_type=personal) */
/*  in one round-trip.                                                     */
/* ---------------------------------------------------------------------- */

const BulkFamilySchema = z.object({
  importId: z.string().uuid(),
  user_id: z.string().uuid(),
});

export async function bulkCreateFamilyCard(
  input: z.infer<typeof BulkFamilySchema>,
): Promise<{ created: number; importDeleted: boolean }> {
  const { household } = await requireSession();
  const hid = household.household_id;
  const { importId, user_id } = BulkFamilySchema.parse(input);
  const sb = getSupabaseServer();

  const { data: imp } = await sb
    .from("card_statement_imports")
    .select("payment_method_id")
    .eq("household_id", hid)
    .eq("id", importId)
    .single();
  if (!imp) throw new Error("インポートが見つかりません。");

  const { data: rowsRaw } = await sb
    .from("staging_card_transactions")
    .select("id, date, amount, merchant, match_group_id")
    .eq("household_id", hid)
    .eq("import_id", importId)
    .eq("status", "unmatched")
    .eq("cardholder", "family");
  const rows = (rowsRaw ?? []) as Array<{
    id: string;
    date: string;
    amount: number;
    merchant: string | null;
    match_group_id: string | null;
  }>;
  if (rows.length === 0) {
    return { created: 0, importDeleted: false };
  }

  let created = 0;
  const monthsTouched = new Set<string>();
  for (const r of rows) {
    if (r.match_group_id) {
      await sb
        .from("staging_card_transactions")
        .update({
          matched_transaction_id: null,
          match_confidence: null,
          match_group_id: null,
          status: "unmatched",
        })
        .eq("household_id", hid)
        .eq("match_group_id", r.match_group_id)
        .neq("id", r.id);
    }
    const txnId = randomUUID();
    const { error: insErr } = await sb.from("transactions").insert({
      id: txnId,
      household_id: hid,
      date: r.date,
      user_id,
      amount: r.amount,
      category_type: "personal",
      category_id: null,
      note: r.merchant ?? null,
      payment_method_id: imp.payment_method_id,
      source: "card-import",
      statement_row_id: r.id,
    });
    if (insErr) throw new Error(`家族カード一括登録の失敗: ${insErr.message}`);
    const { error: updErr } = await sb
      .from("staging_card_transactions")
      .update({
        matched_transaction_id: txnId,
        status: "created",
        match_confidence: 100,
      })
      .eq("household_id", hid)
      .eq("id", r.id);
    if (updErr) throw new Error(updErr.message);
    monthsTouched.add(monthKey(new Date(r.date + "T00:00:00")));
    created++;
  }

  const importDeleted = await maybeAutoDeleteImport(sb, hid, importId);
  for (const ym of monthsTouched) revalidateTag(`hh:${hid}:txn:${ym}`);
  revalidateTag(`hh:${hid}:transactions`);
  revalidateTag(`hh:${hid}:reconcile`);
  return { created, importDeleted };
}

export async function bulkAcceptHighConfidence(
  input: { importId: string; minConfidence: number },
): Promise<{ confirmed: number; importDeleted: boolean }> {
  const { household } = await requireSession();
  const hid = household.household_id;
  const sb = getSupabaseServer();
  const min = Math.max(60, Math.min(100, Math.floor(input.minConfidence)));

  const { data: rowsRaw } = await sb
    .from("staging_card_transactions")
    .select("id, matched_transaction_id, match_confidence, match_group_id")
    .eq("household_id", hid)
    .eq("import_id", input.importId)
    .eq("status", "suggested")
    .gte("match_confidence", min);
  const rows = (rowsRaw ?? []) as Array<{
    id: string;
    matched_transaction_id: string | null;
    match_confidence: number;
    match_group_id: string | null;
  }>;

  // Dedupe by group: a group's representative member is enough — acceptMatch
  // takes care of the whole group. For ungrouped rows the id IS the rep.
  const seenGroups = new Set<string>();
  const reps: { id: string; txnId: string }[] = [];
  for (const r of rows) {
    if (!r.matched_transaction_id) continue;
    if (r.match_group_id) {
      if (seenGroups.has(r.match_group_id)) continue;
      seenGroups.add(r.match_group_id);
    }
    reps.push({ id: r.id, txnId: r.matched_transaction_id });
  }

  let count = 0;
  const monthsTouched = new Set<string>();
  for (const rep of reps) {
    // Reuse acceptMatch's logic by inlining: flips group + stamps txn.
    const { ids, matchedTxnId } = await resolveSiblingIds(sb, hid, rep.id);
    if (!matchedTxnId) continue;
    const { error: e1 } = await sb
      .from("staging_card_transactions")
      .update({ status: "confirmed" })
      .eq("household_id", hid)
      .in("id", ids);
    if (e1) throw new Error(e1.message);
    const { error: e2 } = await sb
      .from("transactions")
      .update({ statement_row_id: ids[0] })
      .eq("household_id", hid)
      .eq("id", matchedTxnId);
    if (e2) throw new Error(e2.message);
    await finalizeFxIfPending(sb, hid, matchedTxnId, ids[0]);
    const ym = await monthOfTxn(sb, hid, matchedTxnId);
    if (ym) monthsTouched.add(ym);
    count += ids.length;
  }
  for (const ym of monthsTouched) revalidateTag(`hh:${hid}:txn:${ym}`);
  if (monthsTouched.size > 0) revalidateTag(`hh:${hid}:transactions`);
  const importDeleted = await maybeAutoDeleteImport(sb, hid, input.importId);
  revalidateTag(`hh:${hid}:reconcile`);
  return { confirmed: count, importDeleted };
}

/* ---------------------------------------------------------------------- */
/*  bulkAcceptFxMatches                                                   */
/*                                                                         */
/*  Travel-mode helper: accept every staging row that matched a pending   */
/*  FX transaction in Pass 1.5. Same path as bulkAcceptHighConfidence but */
/*  filtered to suggestions whose matched txn is fx_status='pending'.     */
/* ---------------------------------------------------------------------- */

export async function bulkAcceptFxMatches(input: { importId: string }): Promise<{
  finalized: number;
  importDeleted: boolean;
}> {
  const { household } = await requireSession();
  const hid = household.household_id;
  const sb = getSupabaseServer();

  const { data: rowsRaw } = await sb
    .from("staging_card_transactions")
    .select("id, matched_transaction_id, match_group_id, status")
    .eq("household_id", hid)
    .eq("import_id", input.importId)
    .eq("status", "suggested");
  const rows = (rowsRaw ?? []) as Array<{
    id: string;
    matched_transaction_id: string | null;
    match_group_id: string | null;
  }>;
  if (rows.length === 0) return { finalized: 0, importDeleted: false };

  const txnIds = Array.from(new Set(rows.map((r) => r.matched_transaction_id).filter(Boolean) as string[]));
  if (txnIds.length === 0) return { finalized: 0, importDeleted: false };
  const { data: pendingTxns } = await sb
    .from("transactions")
    .select("id")
    .eq("household_id", hid)
    .in("id", txnIds)
    .eq("fx_status", "pending");
  const pendingSet = new Set(((pendingTxns ?? []) as Array<{ id: string }>).map((t) => t.id));

  let finalized = 0;
  const monthsTouched = new Set<string>();
  for (const r of rows) {
    if (!r.matched_transaction_id || !pendingSet.has(r.matched_transaction_id)) continue;
    const { ids, matchedTxnId } = await resolveSiblingIds(sb, hid, r.id);
    if (!matchedTxnId) continue;
    const { error: e1 } = await sb
      .from("staging_card_transactions")
      .update({ status: "confirmed" })
      .eq("household_id", hid)
      .in("id", ids);
    if (e1) throw new Error(e1.message);
    const { error: e2 } = await sb
      .from("transactions")
      .update({ statement_row_id: ids[0] })
      .eq("household_id", hid)
      .eq("id", matchedTxnId);
    if (e2) throw new Error(e2.message);
    await finalizeFxIfPending(sb, hid, matchedTxnId, ids[0]);
    const ym = await monthOfTxn(sb, hid, matchedTxnId);
    if (ym) monthsTouched.add(ym);
    finalized++;
  }
  for (const ym of monthsTouched) revalidateTag(`hh:${hid}:txn:${ym}`);
  if (monthsTouched.size > 0) revalidateTag(`hh:${hid}:transactions`);
  const importDeleted = await maybeAutoDeleteImport(sb, hid, input.importId);
  revalidateTag(`hh:${hid}:reconcile`);
  return { finalized, importDeleted };
}
