/**
 * Shape every parser produces. The reconcile pipeline consumes this and
 * never sees the original CSV columns.
 */
export interface ParsedRow {
  /** ISO YYYY-MM-DD. */
  date: string;
  /** Yen, positive for charges, negative for refunds. */
  amount: number;
  /** Original merchant string (for display + alias learning). */
  merchant: string;
  /** Original cells, kept verbatim so audit / re-parse can refer back. */
  raw: {
    date: string;
    amount: string;
    merchant: string;
    extra?: Record<string, string>;
  };
}

export interface ParseResult {
  rows: ParsedRow[];
  /** Lines that didn't yield a usable row, with the reason for triage. */
  skipped: { line: number; raw: string; reason: string }[];
  periodStart: string | null;
  periodEnd: string | null;
}

export type ParserId = "amex" | "amex-pdf" | "generic";

export interface ParserDefinition {
  id: ParserId;
  label: string;
  /**
   * Parse a decoded body. For CSV parsers the body is the CSV text; for PDF
   * parsers it's the text extracted by lib/csvImport/pdf.ts. Throws on hard
   * failures (no usable rows).
   */
  parse: (body: string, opts?: ParserOptions) => ParseResult;
  /** Source format. Drives whether the import action decodes bytes as CSV or extracts PDF text first. */
  inputFormat: "csv" | "pdf";
}

export interface ParserOptions {
  /** For the generic parser: which column index holds which field. */
  columns?: { date: number; amount: number; merchant: number };
  /** For the generic parser: number of header rows to skip. */
  skipHeaderRows?: number;
}
