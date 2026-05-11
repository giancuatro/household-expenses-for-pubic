import type { ParseResult, ParsedRow, ParserDefinition, ParserOptions } from "./types";
import { parseJpDate, parseYen, splitCsvLine, splitCsvLines } from "./normalize";

/**
 * Generic CSV parser. The user picks which column holds the date, amount,
 * and merchant. Header rows can be skipped via `skipHeaderRows`.
 *
 * No magic — if the CSV has a weird format the user has to point us at
 * the right columns. The import wizard renders a column-mapping step
 * before persisting anything.
 */
function parseGeneric(body: string, opts?: ParserOptions): ParseResult {
  const cols = opts?.columns;
  const skipHead = opts?.skipHeaderRows ?? 1;
  if (!cols) {
    throw new Error("汎用パーサ: 列マッピングが必要です（日付/金額/店名）。");
  }

  const lines = splitCsvLines(body);
  const skipped: ParseResult["skipped"] = [];
  const rows: ParsedRow[] = [];
  let minDate: string | null = null;
  let maxDate: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    if (i < skipHead) continue;
    const cells = splitCsvLine(lines[i]);
    const max = Math.max(cols.date, cols.amount, cols.merchant);
    if (cells.length <= max) {
      skipped.push({ line: i + 1, raw: lines[i], reason: "列不足" });
      continue;
    }
    const dateRaw = (cells[cols.date] ?? "").trim();
    const amtRaw = (cells[cols.amount] ?? "").trim();
    const merRaw = (cells[cols.merchant] ?? "").trim();
    const date = parseJpDate(dateRaw);
    const amount = parseYen(amtRaw);
    if (!date || amount === null) {
      skipped.push({ line: i + 1, raw: lines[i], reason: "日付/金額をパースできない" });
      continue;
    }
    if (amount === 0) continue;
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
    throw new Error("汎用パーサ: 取り込める行がありません。列マッピングを確認してください。");
  }

  return { rows, skipped, periodStart: minDate, periodEnd: maxDate };
}

export const genericParser: ParserDefinition = {
  id: "generic",
  label: "汎用（列を指定してインポート）",
  parse: parseGeneric,
  inputFormat: "csv",
};
