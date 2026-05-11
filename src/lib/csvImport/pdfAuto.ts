import type { ParseResult, ParsedRow, ParserDefinition } from "./types";
import { parseJpDate, parseYen } from "./normalize";

/**
 * Auto-detecting PDF statement parser.
 *
 * Card-issuer PDFs differ enormously in their internal text encoding:
 *
 *   - 楽天 / JCB / セゾン / 三井住友: embed a CJK font that pdf2json reads
 *     out cleanly. Dates appear as "2026/03/11" and merchant names as real
 *     Japanese. Transactions can have 1 amount column (JCB) or 5 (楽天:
 *     利用金額 / 手数料 / 支払総額 / 当月請求額 / 翌月繰越残高).
 *
 *   - AMEX (Marriott Bonvoy Premium): embeds a Type3 custom font with
 *     proprietary glyph mappings. pdf2json can't decode the glyphs and
 *     substitutes them with Latin1 extended chars. As a result "月" comes
 *     back as "A", "日" as "À", "年" as "ü", and most kanji as garbage like
 *     "³²DÐÏPCÔÊ" (for "前回分口座振替金額"). Numbers and ASCII / katakana
 *     are preserved.
 *
 * To handle both with one parser:
 *
 *   1. The date regex uses `[^\d\s]` as a single-char separator instead of
 *      locking to 年月日 — that matches both real kanji and AMEX's garbled
 *      A/À/ü.
 *   2. Year may be missing on the date line (AMEX prints just M月D日). We
 *      pre-scan the body for the first full year-bearing date (the
 *      明細書作成日 header) and use that as the reference year for any
 *      year-less rows.
 *   3. Amount regex allows a leading `-` so refund rows come through as
 *      negative integers.
 *   4. AMEX includes a "前回分口座振替金額" row representing the previous
 *      month's bank withdrawal — that's a settlement, not a card charge.
 *      We skip rows whose merchant text is short and lacks any kana or
 *      enough ASCII letters; that catches the bank-withdrawal pattern
 *      without affecting real merchants like "CRUISE AMERICA - CEN".
 *
 * The "first amount after the date" rule already handles the multi-column
 * Rakuten case (column 1 = 利用金額, the real charge) and the single-amount
 * AMEX / JCB case (first == only == charge).
 */

// CJK char class used for left/right boundary checks. Includes CJK unified,
// hiragana, katakana, and half-width katakana (e.g. ｺｽﾄｺ).
const CJK = "\\u4E00-\\u9FFF\\u3040-\\u30FF\\uFF66-\\uFF9F";

// Date at line start. Optional 4-digit year + single-char separator; then
// 1-2 digit month + single-char separator; then 1-2 digit day + optional
// single-char separator. The lookahead requires the day to be followed by
// whitespace, end of line, or a non-digit char — this rejects page numbers
// like "1 /15  ぺ ージ" (separator after month is whitespace, fails) and
// rejects amount-looking strings like "184ポイント" (separator after second
// digit is also a digit, fails).
const DATE_PREFIX_RE =
  /^\s*(?:(\d{4})[^\d\s])?\s*(\d{1,2})[^\d\s](\d{1,2})[^\d\s]?(?=\s|$|[^\d])/;

// Amount token. The sign portion requires WHITESPACE before AND after the
// `-` so that merchant-embedded identifiers like "ARAMARK LAKE POWELL
// C- 96719" or "USCUSTOMS ESTA APPL PMT 098000002" don't get mis-parsed as
// negative amounts. The lookbehind/lookahead reject digits adjacent to CJK
// chars so embedded year fragments (e.g. "...銀行2026/04/22") and "184
// ポイント" can't slip through as amounts.
const AMOUNT_TOKEN_RE = new RegExp(
  `(?<![0-9${CJK}])(?:(?<=\\s)-\\s+)?(?:[¥￥]\\s*)?(\\d{1,3}(?:,\\d{3})+|\\d{3,})(?:\\s*円)?(?![0-9${CJK}])`,
  "g",
);

// Detects "another full date" appearing in the trailing portion of a
// transaction line. AMEX prints its statement period header like
// "2026年3月20日から2026年4月19日まで" — that's two dates on one line.
// If we see that pattern in the merchant region, the line is a header,
// not a transaction, and the "amount" we'd otherwise extract is actually
// a year fragment.
const EMBEDDED_DATE_RE = /\d{4}[^\d\s]\s*\d{1,2}[^\d\s]\s*\d{1,2}/;

/**
 * Scan the body for the first complete 年/月/日 date and return its year.
 * For AMEX PDFs this lands on 明細書作成日 ("2026ü4A19À" → 2026). For
 * Rakuten PDFs this still works (the first dated row carries its own year).
 * Returns null if the body has no year-bearing date.
 */
function findReferenceYear(body: string): number | null {
  const re = /(\d{4})[^\d\s]\s*\d{1,2}[^\d\s]\s*\d{1,2}/;
  const m = body.match(re);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  if (y < 1900 || y > 2200) return null;
  return y;
}

interface DateMatch {
  /** Full text consumed by the date prefix, so the merchant slice starts right after. */
  raw: string;
  /** ISO YYYY-MM-DD. */
  date: string;
}

function matchDate(line: string, refYear: number | null): DateMatch | null {
  const m = line.match(DATE_PREFIX_RE);
  if (!m) return null;
  const [full, y, mo, d] = m;
  const yearStr = y ?? (refYear != null ? String(refYear) : "");
  if (!yearStr) return null;
  // Combine into a normalized YYYY/MM/DD string and let parseJpDate validate
  // calendar bounds.
  const normalized = `${yearStr}/${mo}/${d}`;
  const iso = parseJpDate(normalized);
  if (!iso) return null;
  return { raw: full, date: iso };
}

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
 * reference numbers ("USCUSTOMS ESTA APPL PMT 098000002").
 *
 * Heuristic: real card-statement amounts are written with thousand-separator
 * commas, so prefer the FIRST comma-formatted token. That works for:
 *
 *   - Rakuten (5 amount columns, all commaed, first = 利用金額 ✓)
 *   - AMEX (merchant ID has bare digits, charge column has commas ✓)
 *   - Refunds ("- 49,422" has commas, embedded ID does not ✓)
 *
 * When no comma-formatted token exists, fall back to the rightmost bare
 * token. That covers small amounts like "MAZDA 220" where ¥220 has no
 * comma. If multiple bare candidates exist (rare), the rightmost is more
 * likely the amount column than a merchant suffix.
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
 * — uppercase Latin and extended Latin1 chars only, no kana, very few
 * actual a-z letters. Real refund merchants ("CRUISE AMERICA - CEN", "ST.
 * GEORGE RV PARK", etc.) have a-zA-Z spelling and easily clear the
 * threshold below, so this heuristic only catches the settlement row.
 */
function looksLikeBankWithdrawal(merchant: string, amount: number): boolean {
  if (amount >= 0) return false;
  if (/[぀-ヿｦ-ﾟ]/.test(merchant)) return false;
  const asciiLetters = merchant.match(/[a-zA-Z]/g) ?? [];
  return asciiLetters.length < 10;
}

function parsePdfAuto(body: string): ParseResult {
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
    const dateHit = matchDate(line, refYear);
    if (!dateHit) continue;

    let merchantRaw = line.slice(dateHit.raw.length).trim();

    // Reject header / period lines that carry a second embedded date
    // (e.g. "2026年3月20日から2026年4月19日まで"). The year fragment of
    // the second date would otherwise be captured as a bogus amount.
    if (EMBEDDED_DATE_RE.test(merchantRaw)) continue;

    let firstAmount = pickRowAmount(merchantRaw);
    if (!firstAmount && i + 1 < lines.length) {
      const next = lines[i + 1];
      const a = pickRowAmount(next);
      if (a) {
        firstAmount = a;
        i += 1;
      }
    }
    if (!firstAmount) continue; // dated heading line without an amount

    let merchant = merchantRaw.slice(0, firstAmount.start).trim();
    // Strip Rakuten / 三井住友-style trailing tokens: payment-method labels
    // and 本人/家族/配偶者 indicators that sit between the merchant and the
    // amount cluster. No-op for AMEX rows.
    merchant = merchant
      .replace(/\s*(?:\d{1,2}回(?:払い)?|リボ(?:払い|変更)?|一括(?:払い)?|分割(?:払い|変更)?|ボ(?:\d+回|併用|月))\s*$/u, "")
      .replace(/\s*(?:本人|家族|配偶者)?\*?\s*$/u, "")
      .trim();
    if (!merchant) merchant = "(不明)";

    if (looksLikeBankWithdrawal(merchant, firstAmount.amount)) {
      skipped.push({
        line: i + 1,
        raw: line,
        reason: "前月分の口座振替（カード取引ではない）",
      });
      continue;
    }

    if (!minDate || dateHit.date < minDate) minDate = dateHit.date;
    if (!maxDate || dateHit.date > maxDate) maxDate = dateHit.date;
    rows.push({
      date: dateHit.date,
      amount: firstAmount.amount,
      merchant,
      raw: { date: dateHit.raw, amount: firstAmount.raw, merchant },
    });
  }

  if (rows.length === 0) {
    throw new Error(
      "PDF から取り込める明細行を抽出できませんでした。スキャン版・暗号化 PDF はサポート外です。" +
        "可能であれば CSV 形式の明細をアップロードしてください。",
    );
  }

  return { rows, skipped, periodStart: minDate, periodEnd: maxDate };
}

export const pdfAutoParser: ParserDefinition = {
  id: "pdf-auto",
  label: "PDF（自動判別）",
  parse: parsePdfAuto,
  inputFormat: "pdf",
};
