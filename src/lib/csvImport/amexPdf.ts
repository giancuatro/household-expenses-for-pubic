import type { ParseResult, ParsedRow, ParserDefinition } from "./types";
import { parseJpDate, parseYen } from "./normalize";

/**
 * AMEX (Japan) PDF statement parser.
 *
 * AMEX online portal lets you download the monthly statement as a PDF. The
 * body of each charge row reads roughly:
 *
 *   2026年04月03日   Starbucks Shibuya     ¥620
 *   2026年04月05日   Amazon Japan       ¥3,480
 *
 * After unpdf merges page text, items are separated by whitespace and
 * newlines. We walk lines, find any with a leading date, split off the
 * trailing yen amount, and treat the middle as the merchant.
 *
 * Robust to:
 *   - 和暦 / Western date formats (parseJpDate handles both)
 *   - ¥ / 円 / commas / full-width digits
 *   - Trailing notes like "（一括）", "（リボ）" that show up after the amount
 *   - Multi-line wrap where the merchant name overflows: we look back at the
 *     previous date-bearing line if the current line is amount-only or
 *     merchant-only.
 *
 * Skips:
 *   - Section headers ("ご利用明細", "ご請求金額")
 *   - Subtotal / fee / "今回ご請求金額" lines (no per-charge date)
 *   - Translation / exchange-rate annotations on foreign charges
 */

const DATE_PREFIX_RE =
  /^(?:\d{2,4}[年/\-.]\s*\d{1,2}[月/\-.]\s*\d{1,2}日?)\b/;

// Trailing amount, possibly preceded by ¥, with optional thousands separators
// and surrounded by whitespace. The greedy capture handles "¥1,234".
const AMOUNT_TRAIL_RE = /([¥￥]?\s*[\d,０-９]+\s*円?)\s*$/;

function findFirstDateMatch(line: string): { match: string; rest: string } | null {
  const m = line.match(DATE_PREFIX_RE);
  if (!m) return null;
  return { match: m[0], rest: line.slice(m[0].length).trim() };
}

function parseAmexPdf(body: string): ParseResult {
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

    // Strategy:
    //   - If the rest of the line ends with an amount, we have date + merchant + amount in one line.
    //   - Otherwise the amount may be on the next line; peek ahead.
    let merchantRaw = dateHit.rest;
    let amountRaw: string | null = null;

    const amountInLine = merchantRaw.match(AMOUNT_TRAIL_RE);
    if (amountInLine) {
      amountRaw = amountInLine[1];
      merchantRaw = merchantRaw.slice(0, amountInLine.index).trim();
    } else if (i + 1 < lines.length) {
      const next = lines[i + 1];
      const m = next.match(AMOUNT_TRAIL_RE);
      if (m && m.index === 0) {
        amountRaw = m[1];
        i += 1;
      }
    }

    if (!amountRaw) {
      skipped.push({ line: i + 1, raw: line, reason: "金額が見つからない" });
      continue;
    }
    const amount = parseYen(amountRaw);
    if (amount === null) {
      skipped.push({ line: i + 1, raw: line, reason: `金額パース失敗: ${amountRaw}` });
      continue;
    }
    if (amount === 0) {
      skipped.push({ line: i + 1, raw: line, reason: "金額0" });
      continue;
    }

    if (!merchantRaw) merchantRaw = "(不明)";

    if (!minDate || date < minDate) minDate = date;
    if (!maxDate || date > maxDate) maxDate = date;
    rows.push({
      date,
      amount,
      merchant: merchantRaw,
      raw: { date: dateHit.match, amount: amountRaw, merchant: merchantRaw },
    });
  }

  if (rows.length === 0) {
    throw new Error(
      "AMEX PDF: 取り込める明細行がありません。スキャン版 PDF や暗号化 PDF はサポート外です（CSV をご利用ください）。",
    );
  }

  return { rows, skipped, periodStart: minDate, periodEnd: maxDate };
}

export const amexPdfParser: ParserDefinition = {
  id: "amex-pdf",
  label: "American Express（PDF 明細）",
  parse: parseAmexPdf,
  inputFormat: "pdf",
};
