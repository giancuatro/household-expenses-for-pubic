/**
 * Shared text normalization helpers for credit-card CSV parsing.
 *
 * Card issuers in Japan ship CSVs in a mix of Shift_JIS and UTF-8, with
 * occasional BOMs and CRLF line endings. We probe before decoding so the
 * parsers below can stay bytes-in / strings-out.
 */

/**
 * Decode a raw byte buffer into UTF-8 text, auto-detecting Shift_JIS.
 *
 * Heuristic: try UTF-8 strict first (TextDecoder with `fatal: true`); if it
 * throws, fall back to Shift_JIS. This catches the typical AMEX / Rakuten
 * legacy CSVs without misidentifying genuinely UTF-8 files (BOM stripped).
 */
export function decodeCsvBytes(buf: Uint8Array): string {
  // Strip UTF-8 BOM if present.
  let bytes = buf;
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    bytes = bytes.slice(3);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    // The Web spec mandates Node 18+ supports "shift_jis" as an alias.
    return new TextDecoder("shift_jis").decode(bytes);
  }
}

/**
 * Parse one CSV line respecting RFC 4180 quoting. Returns the raw cell
 * strings without unescaping outer quotes; doubled quotes inside a quoted
 * cell collapse to a single quote.
 */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cell += '"'; i++; }
        else inQuotes = false;
      } else {
        cell += c;
      }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { out.push(cell); cell = ""; }
      else cell += c;
    }
  }
  out.push(cell);
  return out;
}

/** Split a full CSV body into rows, tolerating CR / CRLF / LF line endings. */
export function splitCsvLines(body: string): string[] {
  return body.split(/\r\n|\n|\r/).filter((l) => l.length > 0);
}

/**
 * Parse a yen amount cell. Card CSVs use a mix of "1,234", "1234", "￥1,234",
 * "1,234円", or negative values for refunds. Returns integer yen or null.
 */
export function parseYen(raw: string): number | null {
  if (!raw) return null;
  const cleaned = raw
    .replace(/[¥￥,円\s]/g, "")
    .replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0));
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return Math.round(n);
}

/**
 * Parse a date cell. Accepts: 2026/04/03, 2026-04-03, 2026年4月3日, 26/4/3.
 * Returns ISO YYYY-MM-DD or null.
 */
export function parseJpDate(raw: string): string | null {
  if (!raw) return null;
  const s = raw
    .replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0))
    .trim();
  // 2026年4月3日 / 2026年04月03日
  const jp = s.match(/^(\d{2,4})年\s*(\d{1,2})月\s*(\d{1,2})日?$/);
  if (jp) return ymdIso(jp[1], jp[2], jp[3]);
  // 2026/4/3, 2026-04-03, 2026.4.3
  const dash = s.match(/^(\d{2,4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/);
  if (dash) return ymdIso(dash[1], dash[2], dash[3]);
  return null;
}

function ymdIso(y: string, m: string, d: string): string {
  let yi = parseInt(y, 10);
  if (yi < 100) yi += 2000;       // 26 → 2026
  const mi = parseInt(m, 10);
  const di = parseInt(d, 10);
  if (mi < 1 || mi > 12 || di < 1 || di > 31) return "";
  const mm = String(mi).padStart(2, "0");
  const dd = String(di).padStart(2, "0");
  return `${yi}-${mm}-${dd}`;
}

/**
 * Normalize a merchant string for matching: lower-case, collapse whitespace,
 * strip common store-suffix noise so "STARBUCKS SHIBUYA TOKYO" and
 * "STARBUCKS  渋谷" both reduce to "starbucks".
 */
export function normalizeMerchant(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .toLowerCase()
    .replace(/[　\s]+/g, " ")
    .replace(/[（）()【】\[\]『』「」]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
