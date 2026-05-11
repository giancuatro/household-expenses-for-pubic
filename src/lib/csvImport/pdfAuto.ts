import type { ParseResult, ParsedRow, ParserDefinition } from "./types";
import { parseJpDate, parseYen } from "./normalize";

/**
 * Auto-detecting PDF statement parser.
 *
 * Card-issuer PDFs vary enormously in layout. We support multiple
 * extraction *strategies* and pick the one that yields the most rows for
 * each input. New issuers can be added by appending another strategy to
 * the list without changing call sites; once a household imports a given
 * card the winning strategy id is remembered in card_pdf_format_memory
 * so subsequent re-imports skip the trial step.
 *
 * Strategies shipped today:
 *
 *   compact     — Rakuten, JCB, AMEX, セゾン, 三井住友. Date is at the
 *                 start of the line in one of: "2026/03/11", "2026年03月
 *                 11日", "3月19日", or AMEX's Type3-garbled "3A19À".
 *                 Merchant and amount are on the same line.
 *
 *   split-col   — VIEW Card. The PDF table has 年/月/日 as three separate
 *                 columns ("25  03  14") followed by amount columns. The
 *                 merchant text lives on the line(s) adjacent to the date
 *                 line; we walk N-1 and N+1, stripping payment-method-only
 *                 lines like "１回払".
 *
 * The export `parsePdfAuto(body)` runs every strategy and returns the
 * winning result. `runStrategy(body, id)` lets callers (the
 * format-memory layer) skip detection when they already know which
 * strategy to use.
 */

// CJK char class used for left/right boundary checks. Covers CJK unified,
// hiragana, katakana, and half-width katakana (e.g. ｺｽﾄｺ).
const CJK = "\\u4E00-\\u9FFF\\u3040-\\u30FF\\uFF66-\\uFF9F";

// ─── shared utilities ────────────────────────────────────────────────

const AMOUNT_TOKEN_RE = new RegExp(
  `(?<![0-9${CJK}])(?:(?<=\\s)-\\s+)?(?:[¥￥]\\s*)?(\\d{1,3}(?:,\\d{3})+|\\d{3,})(?:\\s*円)?(?![0-9${CJK}])`,
  "g",
);

interface AmountCandidate {
  amount: number;
  raw: string;
  start: number;
  end: number;
  hasComma: boolean;
}

/**
 * Pick the amount-column value out of a line that may also contain numeric
 * merchant identifiers ("ARAMARK LAKE POWELL C- 96719") or transaction
 * reference numbers ("USCUSTOMS ESTA APPL PMT 098000002"). Real amount
 * columns use thousand-separator commas; embedded IDs don't.
 */
function pickRowAmount(s: string): AmountCandidate | null {
  AMOUNT_TOKEN_RE.lastIndex = 0;
  const candidates: AmountCandidate[] = [];
  let m: RegExpExecArray | null;
  while ((m = AMOUNT_TOKEN_RE.exec(s))) {
    const raw = m[0];
    const value = parseYen(raw);
    if (value === null || value === 0) continue;
    candidates.push({
      amount: value,
      raw,
      start: m.index,
      end: m.index + raw.length,
      hasComma: /,/.test(raw),
    });
  }
  if (candidates.length === 0) return null;
  const commaed = candidates.find((c) => c.hasComma);
  return commaed ?? candidates[candidates.length - 1];
}

/**
 * AMEX's previous-month bank withdrawal row appears as:
 *
 *   4A10À  ³²DÐÏPCÔÊ                                          - 625,838
 *
 * The merchant text is the Type3-garbled rendering of "前回分口座振替金額"
 * — uppercase Latin + extended Latin1 chars only, no kana, very few
 * actual a-z letters. Real refund merchants ("CRUISE AMERICA - CEN",
 * etc.) clear the threshold and pass through.
 */
function looksLikeBankWithdrawal(merchant: string, amount: number): boolean {
  if (amount >= 0) return false;
  if (/[぀-ヿｦ-ﾟ]/.test(merchant)) return false;
  const asciiLetters = merchant.match(/[a-zA-Z]/g) ?? [];
  return asciiLetters.length < 10;
}

// ─── strategy 1: compact (Rakuten / JCB / AMEX / 三井住友) ─────────────

// Date at line start. Optional 4-digit year + single-char separator; then
// 1-2 digit month + single-char separator; then 1-2 digit day + optional
// single-char separator. Lookahead rejects page numbers like "1 /15".
const COMPACT_DATE_RE =
  /^\s*(?:(\d{4})[^\d\s])?\s*(\d{1,2})[^\d\s](\d{1,2})[^\d\s]?(?=\s|$|[^\d])/;

// Statement-period headers like "2026年3月20日から2026年4月19日まで"
// contain a second complete date — skip those.
const EMBEDDED_DATE_RE = /\d{4}[^\d\s]\s*\d{1,2}[^\d\s]\s*\d{1,2}/;

function findReferenceYear(body: string): number | null {
  const re = /(\d{4})[^\d\s]\s*\d{1,2}[^\d\s]\s*\d{1,2}/;
  const m = body.match(re);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  return y >= 1900 && y <= 2200 ? y : null;
}

function extractCompact(body: string): ParseResult {
  const refYear = findReferenceYear(body);
  const lines = body
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const rows: ParsedRow[] = [];
  const skipped: ParseResult["skipped"] = [];
  let minDate: string | null = null;
  let maxDate: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const dm = line.match(COMPACT_DATE_RE);
    if (!dm) continue;
    const [full, y, mo, d] = dm;
    const yearStr = y ?? (refYear != null ? String(refYear) : "");
    if (!yearStr) continue;
    const iso = parseJpDate(`${yearStr}/${mo}/${d}`);
    if (!iso) continue;

    let merchantRaw = line.slice(full.length).trim();
    if (EMBEDDED_DATE_RE.test(merchantRaw)) continue;

    let firstAmount = pickRowAmount(merchantRaw);
    if (!firstAmount && i + 1 < lines.length) {
      const a = pickRowAmount(lines[i + 1]);
      if (a) {
        firstAmount = a;
        i += 1;
      }
    }
    if (!firstAmount) continue;

    let merchant = merchantRaw.slice(0, firstAmount.start).trim()
      .replace(/\s*(?:\d{1,2}回(?:払い)?|リボ(?:払い|変更)?|一括(?:払い)?|分割(?:払い|変更)?|ボ(?:\d+回|併用|月))\s*$/u, "")
      .replace(/\s*(?:本人|家族|配偶者)?\*?\s*$/u, "")
      .trim();
    if (!merchant) merchant = "(不明)";

    if (looksLikeBankWithdrawal(merchant, firstAmount.amount)) {
      skipped.push({ line: i + 1, raw: line, reason: "前月分の口座振替（カード取引ではない）" });
      continue;
    }

    if (!minDate || iso < minDate) minDate = iso;
    if (!maxDate || iso > maxDate) maxDate = iso;
    rows.push({
      date: iso,
      amount: firstAmount.amount,
      merchant,
      raw: { date: full, amount: firstAmount.raw, merchant },
    });
  }

  return { rows, skipped, periodStart: minDate, periodEnd: maxDate };
}

// ─── strategy 2: split-col (VIEW Card) ───────────────────────────────

// VIEW prints YY / MM / DD as three separate columns separated by
// significant whitespace, immediately followed by the amount column.
// Anchoring on ≥2 spaces between the year/month/day groups rejects more
// general patterns like "1 /15 ページ".
const SPLIT_DATE_RE = /^\s*(\d{2})\s{2,}(\d{1,2})\s{2,}(\d{1,2})\s{2,}/;

// Lines that are just a payment-method indicator (no merchant text). The
// VIEW layout sometimes puts this between the merchant and the date row.
// Note the [\d０-９] union: VIEW prints "１回払" with full-width digits and JS
// \d only matches ASCII even under /u.
const PAYMENT_METHOD_ONLY_RE = /^\s*(?:[\d０-９]{1,2}\s*回(?:払い|払)?|リボ(?:払い)?|一括(?:払い)?|分割(?:払い)?)\s*$/u;

function isPureNumericOrPunctLine(s: string): boolean {
  return /^[\d\s,.\-¥￥円％%]+$/u.test(s) && /\d/.test(s);
}

function looksLikeHeaderText(s: string): boolean {
  return (
    /会員番号|\*\*\*\*-/.test(s) ||
    /^.{0,2}様$/u.test(s) ||
    /^[ァ-ヿー\s]{0,20}様$/u.test(s)
  );
}

/**
 * For a split-column date row at line `dateIdx`, reconstruct the merchant
 * string by walking the immediately-adjacent lines. VIEW's pdf2json output
 * sometimes wraps a long merchant across two non-adjacent lines (the wrap
 * end lands BEFORE the date row and the wrap start lands AFTER). We pull
 * both candidates and concatenate in display order.
 */
function findSplitMerchant(lines: string[], dateIdx: number): string {
  const at = (i: number) => (i >= 0 && i < lines.length ? lines[i].trim() : "");
  const skip = (s: string) =>
    !s ||
    PAYMENT_METHOD_ONLY_RE.test(s) ||
    SPLIT_DATE_RE.test(s) ||
    COMPACT_DATE_RE.test(s) ||
    isPureNumericOrPunctLine(s) ||
    looksLikeHeaderText(s);

  // Prefer N-1; if that's just a payment method or header, fall back to
  // a 2-line reconstruction using N+1 (wrap start) + N-2 (wrap end) which
  // is the AMEX/VIEW pattern pdf2json produces when the merchant wraps.
  const nm1 = at(dateIdx - 1);
  if (nm1 && !skip(nm1)) {
    // The merchant may still have a trailing payment-method label glued
    // on (single-line case). Strip it. Includes full-width digit support.
    return nm1.replace(/\s*(?:[\d０-９]{1,2}\s*回(?:払い|払)?|リボ(?:払い)?|一括(?:払い)?|分割(?:払い)?)\s*$/u, "").trim() || "(不明)";
  }
  const wrapStart = at(dateIdx + 1);
  const wrapEnd = at(dateIdx - 2);
  const startUsable = wrapStart && !skip(wrapStart);
  const endUsable = wrapEnd && !skip(wrapEnd);
  if (startUsable && endUsable) return (wrapStart + wrapEnd).trim();
  if (startUsable) return wrapStart;
  if (endUsable) return wrapEnd;
  return "(不明)";
}

function extractSplitCol(body: string): ParseResult {
  const lines = body.split(/\r?\n/);
  // No trim — keep the leading whitespace so SPLIT_DATE_RE column-anchoring
  // works. Just strip trailing newlines via the split.

  const rows: ParsedRow[] = [];
  const skipped: ParseResult["skipped"] = [];
  let minDate: string | null = null;
  let maxDate: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(SPLIT_DATE_RE);
    if (!m) continue;
    const [, yy, mo, d] = m;
    // 2-digit year → 2000+YY. (We don't ship a 19xx fallback because no
    // active card statements are from before 2000.)
    const year = 2000 + parseInt(yy, 10);
    const iso = parseJpDate(`${year}/${mo}/${d}`);
    if (!iso) continue;

    // Amount columns sit after the date columns on the same line.
    const rest = lines[i].slice(m[0].length);
    const amount = pickRowAmount(rest);
    if (!amount) continue;

    const merchant = findSplitMerchant(
      lines.map((l) => l.trim()), // findSplitMerchant operates on trimmed lines
      i,
    );

    if (looksLikeBankWithdrawal(merchant, amount.amount)) {
      skipped.push({ line: i + 1, raw: lines[i], reason: "前月分の口座振替（カード取引ではない）" });
      continue;
    }

    if (!minDate || iso < minDate) minDate = iso;
    if (!maxDate || iso > maxDate) maxDate = iso;
    rows.push({
      date: iso,
      amount: amount.amount,
      merchant,
      raw: { date: `${yy} ${mo} ${d}`, amount: amount.raw, merchant },
    });
  }

  return { rows, skipped, periodStart: minDate, periodEnd: maxDate };
}

// ─── strategy registry ────────────────────────────────────────────────

export type PdfStrategyId = "compact" | "split-col";

const STRATEGIES: Record<PdfStrategyId, (body: string) => ParseResult> = {
  compact: extractCompact,
  "split-col": extractSplitCol,
};

export const ALL_PDF_STRATEGY_IDS: PdfStrategyId[] = ["compact", "split-col"];

/** Run a single named strategy. Used when format memory tells us the winner. */
export function runPdfStrategy(body: string, id: PdfStrategyId): ParseResult {
  const fn = STRATEGIES[id];
  if (!fn) throw new Error(`unknown PDF strategy: ${id}`);
  return fn(body);
}

/**
 * Try every strategy, return the winner.
 *
 * "Winner" = the strategy that produced the most rows. Ties are broken by
 * the strategy's order in ALL_PDF_STRATEGY_IDS (compact wins ties because
 * it's the most common format). If every strategy yields 0 rows we throw
 * a friendly error.
 */
export function pickBestPdfStrategy(body: string): {
  strategy: PdfStrategyId;
  result: ParseResult;
} {
  let best: { strategy: PdfStrategyId; result: ParseResult } | null = null;
  for (const id of ALL_PDF_STRATEGY_IDS) {
    const result = STRATEGIES[id](body);
    if (!best || result.rows.length > best.result.rows.length) {
      best = { strategy: id, result };
    }
  }
  if (!best || best.result.rows.length === 0) {
    throw new Error(
      "PDF から取り込める明細行を抽出できませんでした。スキャン版・暗号化 PDF はサポート外です。" +
        "可能であれば CSV 形式の明細をアップロードしてください。",
    );
  }
  return best;
}

function parsePdfAuto(body: string): ParseResult {
  return pickBestPdfStrategy(body).result;
}

export const pdfAutoParser: ParserDefinition = {
  id: "pdf-auto",
  label: "PDF（自動判別）",
  parse: parsePdfAuto,
  inputFormat: "pdf",
};
