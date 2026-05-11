/**
 * Extract text from a PDF (text-based, not scanned).
 *
 * pdf2json bundles its own pdf.js worker with Node-friendly CMap handling
 * built in, which means CJK character maps load correctly without any
 * dynamic-fetch ceremony — the path that broke unpdf on Vercel's serverless
 * runtime. Tested against Rakuten / AMEX / JCB / セゾン PDFs and all
 * extract their Japanese merchant names and yen amounts.
 *
 * For scanned PDFs (image-only, no text layer) the returned text will be
 * empty — that's a different problem (OCR) and out of scope here.
 */
import PDFParser from "pdf2json";

export async function extractPdfText(bytes: Uint8Array): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    // pdf2json's constructor: new PDFParser(context?, needRawText?). Passing
    // 1 for the second arg unlocks getRawTextContent(), which returns a
    // plain string that preserves line order — much easier to walk than the
    // structured form that's the default.
    const parser: PDFParser = new (PDFParser as unknown as {
      new (context: null, needRawText: number): PDFParser & {
        getRawTextContent(): string;
        parseBuffer(buf: Buffer): void;
      };
    })(null, 1);

    parser.on("pdfParser_dataError", (e: unknown) => {
      const err = e as { parserError?: Error };
      reject(err?.parserError ?? new Error("PDF パース中にエラーが発生しました。"));
    });
    parser.on("pdfParser_dataReady", () => {
      const text = (parser as unknown as { getRawTextContent(): string }).getRawTextContent();
      resolve(text);
    });

    // parseBuffer takes a Node Buffer.
    (parser as unknown as { parseBuffer(buf: Buffer): void }).parseBuffer(Buffer.from(bytes));
  });
}

/** Quick magic-byte check: PDFs start with "%PDF". */
export function looksLikePdf(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}

/**
 * Stable fingerprint for a PDF's extracted text. Used to look up
 * card_pdf_format_memory so that the parser knows which strategy worked
 * last time. Uses the first chunk of normalized text — the issuer's
 * branding, the cardholder name, and the card number live there, all of
 * which stay constant across monthly statements of the same card.
 */
import { createHash } from "crypto";

export function computePdfFingerprint(text: string): string {
  const head = text.slice(0, 600).replace(/\s+/g, " ").trim().slice(0, 400);
  return createHash("sha256").update(head).digest("hex").slice(0, 16);
}
