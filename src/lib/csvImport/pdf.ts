/**
 * Extract text from a PDF (text-based, not scanned).
 *
 * Card-issuer statements (AMEX, JCB, Saison, etc.) ship as text-based PDFs:
 * the body is real text we can read, not a rendered scan. `unpdf` is a thin
 * serverless-safe wrapper over pdf.js that runs cleanly on Vercel's Node
 * runtime without bundling the canvas / DOM polyfills the upstream PDF.js
 * worker expects.
 *
 * For scanned PDFs the returned text will be empty — that's a different
 * problem (OCR) and out of scope here. The reconcile import surfaces an
 * empty-rows error in that case so the user knows to re-export as CSV.
 */
export async function extractPdfText(bytes: Uint8Array): Promise<string> {
  // Dynamic import keeps unpdf out of the client bundle. Server actions are
  // the only call site.
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: true });
  return Array.isArray(text) ? text.join("\n") : text;
}

/** Quick magic-byte check: PDFs start with "%PDF". */
export function looksLikePdf(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}
