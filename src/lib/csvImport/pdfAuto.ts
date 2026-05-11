import type { ParseResult, ParsedRow, ParserDefinition } from "./types";
import { parseJpDate, parseYen } from "./normalize";

/**
 * Auto-detecting PDF statement parser.
 *
 * Almost every Japanese card issuer (AMEX, 楽天カード, JCB, セゾン, 三井住友,
 * イオン, dカード …) prints transactions with a date at the start of the
 * row and one-or-more yen amounts trailing it. The shapes diverge in the
 * middle (merchant text format, user / payment-method columns, ...) and
 * in how many amount columns they emit:
 *
 *   AMEX:       2026年04月03日   Starbucks Shibuya     ¥620
 *               (date) (merchant) (amount)
 *
 *   Rakuten:    2026/03/11ｺｽﾄｺ ﾎ-ﾙｾ-ﾙ ｼﾞﾔﾊ本人* 1回払い  2,556  0  2,556  2,556  0
 *               (date)(merchant)(user)(method)(charge)(fee)(total)(this-mo)(carry)
 *
 *   JCB:        2026/04/05 セブン-イレブン      ¥412
 *
 * We walk every line, anchor on a leading date, and take the FIRST
 * amount-looking token that follows. For one-amount issuers (AMEX, JCB)
 * "first" == "only" == the charge. For multi-amount issuers (Rakuten,
 * 三井住友) the first column is "利用金額" — the actual charge — which is
 * what reconciliation needs. The trailing columns are derived totals and
 * carry-over balances; taking the last one would silently wreck the
 * reconciliation (it's usually 0 or the carry).
 *
 * "Amount-looking" means: contains a thousand-separator (e.g. 2,556) OR
 * three+ consecutive digits (e.g. 15980) OR has a yen prefix/suffix.
 * Bare single/double digits are rejected because card line items like
 * "1回払い" or "本人*" contain "1" but aren't amounts.
 */

// Leading-date matcher: accept 和暦 (2026年04月03日) and Western (2026/04/03,
// 2026-04-03, 2026.04.03) forms.
const DATE_PREFIX_RE =
  /^(?:\d{2,4}[年/\-.]\s*\d{1,2}[月/\-.]\s*\d{1,2}日?)/;

// Amount token: ¥/￥ prefix optional, comma-grouped digits or 3+ bare digits,
// optional 円 suffix. The lookbehind/lookahead reject neighbours that imply
// the number is part of another token:
//
//   - 「住信ＳＢＩネット銀行2026/04/22」 → "2026" is preceded by 行 (kanji)
//     and is a year fragment, not an amount.
//   - 「184ポイント」 → 184 is followed by ポ (kana), so it's points, not yen.
//   - 「1回払い」 → "1" is only 1 digit AND followed by 回 (kanji); both rules
//     reject it.
//
// The char class covers CJK Unified (一-鿿), hiragana + katakana
// (぀-ヿ), and half-width katakana (ｦ-ﾟ) which Rakuten
// uses for merchant names like ｺｽﾄｺ ﾎ-ﾙｾ-ﾙ.
const CJK = "\\u4E00-\\u9FFF\\u3040-\\u30FF\\uFF66-\\uFF9F";
const AMOUNT_TOKEN_RE = new RegExp(
  `(?<![0-9${CJK}])(?:[¥￥]\\s*)?(\\d{1,3}(?:,\\d{3})+|\\d{3,})(?:\\s*円)?(?![0-9${CJK}])`,
  "g",
);

function findFirstDateMatch(line: string): { match: string; rest: string } | null {
  const m = line.match(DATE_PREFIX_RE);
  if (!m) return null;
  return { match: m[0], rest: line.slice(m[0].length).trim() };
}

/**
 * Find the first amount-looking token in `s` and return its value + the
 * character range it occupied (so the caller can slice out the merchant
 * portion that came before it).
 */
function findFirstAmount(s: string): { amount: number; raw: string; start: number; end: number } | null {
  AMOUNT_TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = AMOUNT_TOKEN_RE.exec(s))) {
    const raw = m[0];
    const value = parseYen(raw);
    if (value === null || value === 0) continue;
    return { amount: value, raw, start: m.index, end: m.index + raw.length };
  }
  return null;
}

function parsePdfAuto(body: string): ParseResult {
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
    const dateHit = findFirstDateMatch(line);
    if (!dateHit) continue;
    const date = parseJpDate(dateHit.match);
    if (!date) {
      skipped.push({ line: i + 1, raw: line, reason: "日付パース失敗" });
      continue;
    }

    // Try same-line amount first; if none, peek at the next line (some
    // issuers wrap the amount when merchant name is long).
    let merchantRaw = dateHit.rest;
    let firstAmount = findFirstAmount(merchantRaw);
    if (!firstAmount && i + 1 < lines.length) {
      const next = lines[i + 1];
      const a = findFirstAmount(next);
      if (a) {
        firstAmount = a;
        i += 1;
        // Merchant remains the current line's full rest.
      }
    }
    if (!firstAmount) {
      // Date-bearing line but no amount — probably a section header like
      // "ご請求年月" with a YYYY/MM-looking string. Skip silently.
      continue;
    }

    // Strip the amount + everything after it from the merchant text.
    // Common trailing junk after the charge amount on Rakuten / 三井住友
    // includes the user, payment-method, and the four derived totals —
    // none of which improve matching.
    let merchant = merchantRaw.slice(0, firstAmount.start).trim();
    // Trim Rakuten-style trailing tokens like "本人*" or "1回払い" that
    // sit between the merchant proper and the amount cluster. The pattern
    // catches `<digits>回(払い)?`, `(本人|家族|配偶者)?\*?`, リボ, 一括, ボ系.
    merchant = merchant
      .replace(/\s*(?:\d{1,2}回(?:払い)?|リボ(?:払い|変更)?|一括(?:払い)?|分割(?:払い|変更)?|ボ(?:\d+回|併用|月))\s*$/u, "")
      .replace(/\s*(?:本人|家族|配偶者)?\*?\s*$/u, "")
      .trim();
    if (!merchant) merchant = "(不明)";

    if (!minDate || date < minDate) minDate = date;
    if (!maxDate || date > maxDate) maxDate = date;
    rows.push({
      date,
      amount: firstAmount.amount,
      merchant,
      raw: { date: dateHit.match, amount: firstAmount.raw, merchant },
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
