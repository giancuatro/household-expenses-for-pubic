import type { ParseResult, ParsedRow, ParserDefinition } from "./types";
import { parseJpDate, parseYen, splitCsvLine, splitCsvLines } from "./normalize";

/**
 * Auto-detecting CSV parser for Japanese credit-card statements.
 *
 * The vast majority of issuer CSVs in Japan share the same three columns,
 * just with different names. Rather than ship a hand-rolled parser per
 * brand and ask the user to pick one, we read the header row, look for
 * Japanese keywords, and map to (date, merchant, amount). This covers
 * AMEX, Rakuten, JCB, Saison, 三井住友, dカード, イオン, and others without
 * configuration.
 *
 * Header detection is deliberately tolerant:
 *   - Header may be on the first line, or buried after a banner / blank
 *     lines (some banks prefix their export with a "明細" title row).
 *   - Header may use Shift_JIS-only katakana ("ご利用日") or ASCII
 *     ("Date", "Amount").
 *   - Date columns can also be labelled 利用年月日 / 取引日 / 日付.
 *   - Amount columns can be labelled ご利用金額 / 利用金額 / 金額 /
 *     ご請求金額 / Amount.
 *   - Merchant columns: ご利用場所 / ご利用内容 / ご利用先 /
 *     利用店名 / 加盟店名 / お店 / 摘要 / 内容 / Description.
 *
 * Rows that fail to parse a date or amount are recorded in `skipped` so
 * the user can see why; the import proceeds with whatever rows did parse.
 */

const DATE_KW = [
  /ご利用日/, /利用日/, /利用年月日/, /取引日/, /^日付$/, /年月日/, /^date$/i,
];
const MERCHANT_KW = [
  /ご利用場所/, /ご利用内容/, /ご利用先/, /利用店名/, /店舗名/, /加盟店名/, /利用先/,
  /商品名/, /お店/, /^摘要$/, /^内容$/, /description/i, /merchant/i, /payee/i,
];
const AMOUNT_KW = [
  /ご利用金額/, /利用金額/, /ご請求金額/, /^金額$/, /amount/i, /charge/i,
];
const AMOUNT_DENYLIST = [
  // Avoid latching onto running totals / fees that share the "金額" stem.
  /合計/, /累計/, /総額/, /手数料/, /ポイント/, /残高/, /balance/i, /total/i, /fee/i,
];
const CARDHOLDER_KW = [
  /ご利用者/, /^利用者$/, /カード利用者/, /会員区分/, /^区分$/, /cardholder/i,
];

function detectCardholderFromCell(cell: string | undefined): "primary" | "family" | null {
  if (!cell) return null;
  if (/(?:家族|配偶者|サブ|追加)/u.test(cell)) return "family";
  if (/本人|メイン/u.test(cell)) return "primary";
  return null;
}

function findColIndex(header: string[], allow: RegExp[], deny: RegExp[] = []): number {
  for (let i = 0; i < header.length; i++) {
    const cell = header[i].trim();
    if (!cell) continue;
    if (deny.some((re) => re.test(cell))) continue;
    if (allow.some((re) => re.test(cell))) return i;
  }
  return -1;
}

/** Score a row's "header-ness": more keyword hits = more likely a header. */
function headerScore(cells: string[]): number {
  let s = 0;
  if (findColIndex(cells, DATE_KW) >= 0) s++;
  if (findColIndex(cells, MERCHANT_KW) >= 0) s++;
  if (findColIndex(cells, AMOUNT_KW, AMOUNT_DENYLIST) >= 0) s++;
  return s;
}

function parseCsvAuto(body: string): ParseResult {
  const lines = splitCsvLines(body);
  const skipped: ParseResult["skipped"] = [];
  if (lines.length === 0) return { rows: [], skipped, periodStart: null, periodEnd: null };

  // Look up to the first 10 lines for the best header candidate.
  let headerIdx = -1;
  let bestScore = 0;
  let header: string[] = [];
  for (let i = 0; i < Math.min(10, lines.length); i++) {
    const cells = splitCsvLine(lines[i]);
    const s = headerScore(cells);
    if (s > bestScore) {
      bestScore = s;
      headerIdx = i;
      header = cells;
    }
    if (s === 3) break;
  }
  if (headerIdx === -1 || bestScore < 2) {
    throw new Error(
      "CSV のヘッダ（日付・店名・金額の列）を見つけられません。CSV の形式を確認するか、" +
        "AMEX 等の標準フォーマットに変換してから再度アップロードしてください。",
    );
  }

  const dateIdx = findColIndex(header, DATE_KW);
  const merIdx = findColIndex(header, MERCHANT_KW);
  const amtIdx = findColIndex(header, AMOUNT_KW, AMOUNT_DENYLIST);
  const cardholderIdx = findColIndex(header, CARDHOLDER_KW);
  if (dateIdx < 0 || amtIdx < 0) {
    throw new Error("CSV のヘッダから日付列または金額列を特定できませんでした。");
  }

  const rows: ParsedRow[] = [];
  let minDate: string | null = null;
  let maxDate: string | null = null;

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    if (cells.length <= Math.max(dateIdx, amtIdx, merIdx)) {
      skipped.push({ line: i + 1, raw: lines[i], reason: "列不足" });
      continue;
    }
    const dateRaw = (cells[dateIdx] ?? "").trim();
    const merRaw = merIdx >= 0 ? (cells[merIdx] ?? "").trim() : "";
    const amtRaw = (cells[amtIdx] ?? "").trim();
    const date = parseJpDate(dateRaw);
    const amount = parseYen(amtRaw);
    if (!date) {
      skipped.push({ line: i + 1, raw: lines[i], reason: `日付パース失敗: ${dateRaw}` });
      continue;
    }
    if (amount === null) {
      skipped.push({ line: i + 1, raw: lines[i], reason: `金額パース失敗: ${amtRaw}` });
      continue;
    }
    if (amount === 0) continue; // silent skip — likely an empty total row
    if (!minDate || date < minDate) minDate = date;
    if (!maxDate || date > maxDate) maxDate = date;
    const cardholder = cardholderIdx >= 0
      ? detectCardholderFromCell(cells[cardholderIdx])
      : detectCardholderFromCell(merRaw);
    rows.push({
      date,
      amount,
      merchant: merRaw,
      cardholder,
      raw: { date: dateRaw, amount: amtRaw, merchant: merRaw },
    });
  }

  if (rows.length === 0) {
    throw new Error("CSV に取り込める明細行がありません。形式をご確認ください。");
  }

  return { rows, skipped, periodStart: minDate, periodEnd: maxDate };
}

export const csvAutoParser: ParserDefinition = {
  id: "csv-auto",
  label: "CSV（自動判別）",
  parse: parseCsvAuto,
  inputFormat: "csv",
};
