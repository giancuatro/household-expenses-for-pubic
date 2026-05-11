import type { ParseResult, ParsedRow, ParserDefinition } from "./types";
import { parseJpDate, parseYen } from "./normalize";

/**
 * Auto-detecting PDF statement parser.
 *
 * Almost every Japanese card issuer (AMEX, 楽天カード, JCB, セゾン, 三井住友,
 * イオン, dカード …) prints transactions in the same shape: a date prefix
 * at the start of a line followed by a merchant string, with the yen
 * amount trailing on the same line or the next. Rather than ship a
 * brand-specific parser per issuer, we walk every line and pull rows that
 * match this pattern.
 *
 * Robust to:
 *   - 和暦 / Western date formats (parseJpDate handles both)
 *   - ¥ / 円 / commas / full-width digits
 *   - Multi-line wrap where the amount is on the next line
 *   - Section headers, "ご請求金額" totals, exchange-rate annotations —
 *     these lines either lack a leading date or lack a trailing amount,
 *     so they fall out of the loop naturally.
 *
 * Out of scope:
 *   - Scanned / image PDFs — text extraction returns empty and we throw a
 *     clear error pointing the user at the CSV export instead.
 *   - Encrypted PDFs — same outcome.
 */

const DATE_PREFIX_RE =
  /^(?:\d{2,4}[年/\-.]\s*\d{1,2}[月/\-.]\s*\d{1,2}日?)\b/;

const AMOUNT_TRAIL_RE = /([¥￥]?\s*[\d,０-９]+\s*円?)\s*$/;

function findFirstDateMatch(line: string): { match: string; rest: string } | null {
  const m = line.match(DATE_PREFIX_RE);
  if (!m) return null;
  return { match: m[0], rest: line.slice(m[0].length).trim() };
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
      // No amount → not a transaction line (probably a date-looking heading).
      continue;
    }
    const amount = parseYen(amountRaw);
    if (amount === null) {
      skipped.push({ line: i + 1, raw: line, reason: `金額パース失敗: ${amountRaw}` });
      continue;
    }
    if (amount === 0) continue;
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
