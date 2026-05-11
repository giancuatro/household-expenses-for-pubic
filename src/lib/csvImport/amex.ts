import type { ParseResult, ParsedRow, ParserDefinition } from "./types";
import { parseJpDate, parseYen, splitCsvLine, splitCsvLines } from "./normalize";

/**
 * AMEX (Japan) statement CSV parser.
 *
 * The AMEX online portal lets cardholders download monthly statements as
 * CSV. The columns we care about are:
 *
 *   ご利用日 / ご利用場所・ご利用内容 / ご利用金額（￥） / 支払方法 / ...
 *
 * The header row is in Shift_JIS in the legacy export, UTF-8 in the new
 * one — we already decoded both upstream. Rows where ご利用金額 is empty or
 * the line is a translation row ("（換算レート ... ）") are skipped.
 *
 * Refunds appear with a leading minus sign and are preserved as negative
 * amounts so the matcher can pair them with returns.
 */
function findColumnIndex(header: string[], candidates: RegExp[]): number {
  for (let i = 0; i < header.length; i++) {
    const cell = header[i].trim();
    if (candidates.some((re) => re.test(cell))) return i;
  }
  return -1;
}

const DATE_COL = [/^ご利用日$/, /^利用日$/, /利用年月日/];
const MERCHANT_COL = [/ご利用場所/, /ご利用内容/, /利用店名/, /^内容$/];
const AMOUNT_COL = [/ご利用金額/, /利用金額/, /^金額$/];

function parseAmex(body: string): ParseResult {
  const lines = splitCsvLines(body);
  const skipped: ParseResult["skipped"] = [];
  if (lines.length === 0) return { rows: [], skipped, periodStart: null, periodEnd: null };

  // Header may not be the first line — AMEX sometimes prefixes a "明細"
  // banner. Scan up to the first 5 lines for one that contains ご利用日.
  let headerIdx = -1;
  let header: string[] = [];
  for (let i = 0; i < Math.min(5, lines.length); i++) {
    const cells = splitCsvLine(lines[i]);
    if (cells.some((c) => /ご利用日|利用日/.test(c))) {
      headerIdx = i;
      header = cells;
      break;
    }
  }
  if (headerIdx === -1) {
    throw new Error("AMEX: ヘッダ行（ご利用日 ...）が見つかりません。");
  }

  const dateIdx = findColumnIndex(header, DATE_COL);
  const merIdx = findColumnIndex(header, MERCHANT_COL);
  const amtIdx = findColumnIndex(header, AMOUNT_COL);
  if (dateIdx < 0 || merIdx < 0 || amtIdx < 0) {
    throw new Error("AMEX: 必要な列（日付 / 利用先 / 金額）が揃っていません。");
  }

  const rows: ParsedRow[] = [];
  let minDate: string | null = null;
  let maxDate: string | null = null;

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    if (cells.length <= Math.max(dateIdx, merIdx, amtIdx)) {
      skipped.push({ line: i + 1, raw: lines[i], reason: "列不足" });
      continue;
    }
    const dateRaw = cells[dateIdx]?.trim() ?? "";
    const merRaw = cells[merIdx]?.trim() ?? "";
    const amtRaw = cells[amtIdx]?.trim() ?? "";
    const date = parseJpDate(dateRaw);
    const amount = parseYen(amtRaw);
    if (!date || amount === null) {
      skipped.push({ line: i + 1, raw: lines[i], reason: "日付/金額をパースできない" });
      continue;
    }
    if (amount === 0) {
      skipped.push({ line: i + 1, raw: lines[i], reason: "金額0" });
      continue;
    }
    if (!minDate || date < minDate) minDate = date;
    if (!maxDate || date > maxDate) maxDate = date;
    rows.push({
      date,
      amount,
      merchant: merRaw,
      raw: { date: dateRaw, amount: amtRaw, merchant: merRaw },
    });
  }

  if (rows.length === 0) {
    throw new Error("AMEX: 取り込める行がありません。CSV の形式を確認してください。");
  }

  return { rows, skipped, periodStart: minDate, periodEnd: maxDate };
}

export const amexParser: ParserDefinition = {
  id: "amex",
  label: "American Express（CSV 明細）",
  parse: parseAmex,
  inputFormat: "csv",
};
