import { csvAutoParser } from "./csvAuto";
import { pdfAutoParser } from "./pdfAuto";
import { looksLikePdf } from "./pdf";
import type { ParserDefinition, ParserId } from "./types";

export const PARSERS: Record<ParserId, ParserDefinition> = {
  "csv-auto": csvAutoParser,
  "pdf-auto": pdfAutoParser,
};

export function getParser(id: ParserId): ParserDefinition {
  return PARSERS[id];
}

/** Pick the right parser from raw file bytes — PDF magic bytes vs CSV. */
export function detectParser(bytes: Uint8Array): ParserDefinition {
  return looksLikePdf(bytes) ? pdfAutoParser : csvAutoParser;
}

export { decodeCsvBytes, normalizeMerchant, splitCsvLine, splitCsvLines } from "./normalize";
export { computePdfFingerprint, extractPdfText, looksLikePdf } from "./pdf";
export { ALL_PDF_STRATEGY_IDS, pickBestPdfStrategy, runPdfStrategy } from "./pdfAuto";
export type { PdfStrategyId } from "./pdfAuto";
export type { ParsedRow, ParseResult, ParserDefinition, ParserId } from "./types";
