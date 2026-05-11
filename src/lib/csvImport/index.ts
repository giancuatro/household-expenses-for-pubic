import { amexParser } from "./amex";
import { amexPdfParser } from "./amexPdf";
import { genericParser } from "./generic";
import type { ParserDefinition, ParserId } from "./types";

export const PARSERS: Record<ParserId, ParserDefinition> = {
  amex: amexParser,
  "amex-pdf": amexPdfParser,
  generic: genericParser,
};

export function getParser(id: string): ParserDefinition | null {
  return PARSERS[id as ParserId] ?? null;
}

export { decodeCsvBytes, normalizeMerchant, splitCsvLine, splitCsvLines } from "./normalize";
export { extractPdfText, looksLikePdf } from "./pdf";
export type { ParsedRow, ParseResult, ParserDefinition, ParserId, ParserOptions } from "./types";
