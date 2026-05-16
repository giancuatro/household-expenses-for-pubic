/**
 * Shape every parser produces. The reconcile pipeline consumes this and
 * never sees the original CSV / PDF content.
 */
export interface ParsedRow {
  /** ISO YYYY-MM-DD. */
  date: string;
  /** Yen, positive for charges, negative for refunds. */
  amount: number;
  /** Original merchant string (for display + alias learning). */
  merchant: string;
  /**
   * Which cardholder swiped this row, when the statement makes it explicit.
   * Japanese card PDFs commonly stamp every line with 本人 / 家族 / 配偶者.
   * NULL means the parser couldn't tell — treat as primary for defaults.
   */
  cardholder?: "primary" | "family" | null;
  /** Original cells / fragments kept verbatim so audit / re-parse can refer back. */
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

/**
 * Internal parser identifier. The UI no longer exposes parser choice — the
 * server detects whether the upload is CSV or PDF from magic bytes and
 * dispatches accordingly. We keep the discriminator so the import history
 * can still record which path handled each file.
 */
export type ParserId = "csv-auto" | "pdf-auto";

export interface ParserDefinition {
  id: ParserId;
  label: string;
  /**
   * Parse a decoded body. For CSV parsers the body is the decoded text;
   * for PDF parsers it's the text already extracted by lib/csvImport/pdf.ts.
   * Throws on hard failures (no usable rows).
   */
  parse: (body: string) => ParseResult;
  /** Drives whether the import action decodes bytes as CSV or runs PDF extraction first. */
  inputFormat: "csv" | "pdf";
}
