import { amexParser } from "./amex";
import { genericParser } from "./generic";
import type { ParserDefinition } from "./types";

export const PARSERS: Record<ParserDefinition["id"], ParserDefinition> = {
  amex: amexParser,
  generic: genericParser,
};

export type ParserId = ParserDefinition["id"];

export function getParser(id: string): ParserDefinition | null {
  return PARSERS[id as ParserId] ?? null;
}

export { decodeCsvBytes, normalizeMerchant, splitCsvLine, splitCsvLines } from "./normalize";
export type { ParsedRow, ParseResult, ParserDefinition, ParserOptions } from "./types";
