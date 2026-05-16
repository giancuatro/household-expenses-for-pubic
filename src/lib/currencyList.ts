/**
 * Currency master used by travel mode.
 *
 * `plausibleJpyRange` is the historical JPY-per-1-unit band we use as a
 * sanity check in the reconcile FX matcher: when a card row's JPY amount
 * divided by a pending transaction's original amount falls inside the band,
 * we treat the pair as a match candidate. Bands are intentionally wide so
 * unusual moves don't silently break matching.
 */
export interface CurrencyDef {
  /** ISO 4217. */
  code: string;
  /** Japanese display name. */
  name: string;
  /** Symbol used in compact rendering (¥, $, €, …). */
  symbol: string;
  /** Decimal places to show in the UI. Most currencies use 2; KRW/IDR/VND use 0. */
  fractionDigits: number;
  /** Plausible JPY value of 1 unit. Used as a guardrail in reconcile matching. */
  plausibleJpyRange: [number, number];
}

export const CURRENCIES: CurrencyDef[] = [
  { code: "USD", name: "米ドル",          symbol: "$",  fractionDigits: 2, plausibleJpyRange: [80, 250] },
  { code: "EUR", name: "ユーロ",          symbol: "€",  fractionDigits: 2, plausibleJpyRange: [100, 250] },
  { code: "GBP", name: "英ポンド",        symbol: "£",  fractionDigits: 2, plausibleJpyRange: [120, 300] },
  { code: "KRW", name: "韓国ウォン",      symbol: "₩",  fractionDigits: 0, plausibleJpyRange: [0.05, 0.20] },
  { code: "TWD", name: "台湾ドル",        symbol: "NT$",fractionDigits: 2, plausibleJpyRange: [2.5, 6.5] },
  { code: "CNY", name: "中国元",          symbol: "¥",  fractionDigits: 2, plausibleJpyRange: [12, 30] },
  { code: "HKD", name: "香港ドル",        symbol: "HK$",fractionDigits: 2, plausibleJpyRange: [10, 25] },
  { code: "THB", name: "タイバーツ",      symbol: "฿",  fractionDigits: 2, plausibleJpyRange: [2, 6] },
  { code: "SGD", name: "シンガポールドル",symbol: "S$", fractionDigits: 2, plausibleJpyRange: [60, 130] },
  { code: "AUD", name: "豪ドル",          symbol: "A$", fractionDigits: 2, plausibleJpyRange: [60, 150] },
  { code: "NZD", name: "NZ ドル",         symbol: "NZ$",fractionDigits: 2, plausibleJpyRange: [55, 140] },
  { code: "CAD", name: "カナダドル",      symbol: "C$", fractionDigits: 2, plausibleJpyRange: [70, 170] },
  { code: "CHF", name: "スイスフラン",    symbol: "Fr", fractionDigits: 2, plausibleJpyRange: [100, 230] },
  { code: "IDR", name: "インドネシア ルピア", symbol: "Rp", fractionDigits: 0, plausibleJpyRange: [0.005, 0.02] },
  { code: "VND", name: "ベトナム ドン",   symbol: "₫",  fractionDigits: 0, plausibleJpyRange: [0.003, 0.012] },
  { code: "PHP", name: "フィリピン ペソ", symbol: "₱",  fractionDigits: 2, plausibleJpyRange: [1.5, 4] },
  { code: "MYR", name: "マレーシア リンギット", symbol: "RM", fractionDigits: 2, plausibleJpyRange: [20, 50] },
  { code: "INR", name: "インド ルピー",   symbol: "₹",  fractionDigits: 2, plausibleJpyRange: [1, 3] },
  { code: "MOP", name: "マカオ パタカ",   symbol: "MOP",fractionDigits: 2, plausibleJpyRange: [10, 25] },
  { code: "MNT", name: "モンゴル トゥグルグ", symbol: "₮", fractionDigits: 0, plausibleJpyRange: [0.02, 0.08] },
];

const BY_CODE = new Map(CURRENCIES.map((c) => [c.code, c]));

/** Look up a currency; returns a sensible fallback for unknown codes so UI doesn't crash. */
export function getCurrency(code: string | null | undefined): CurrencyDef {
  if (!code) return DEFAULT_CURRENCY;
  return BY_CODE.get(code.toUpperCase()) ?? {
    code: code.toUpperCase(),
    name: code.toUpperCase(),
    symbol: code.toUpperCase(),
    fractionDigits: 2,
    plausibleJpyRange: [0.001, 1000],
  };
}

export const DEFAULT_CURRENCY: CurrencyDef = CURRENCIES[0];

/** Format a foreign amount with its symbol; e.g. "$25.50", "NT$1,200", "₩5,000". */
export function formatForeign(amount: number, code: string): string {
  const c = getCurrency(code);
  const n = amount.toLocaleString("ja-JP", {
    minimumFractionDigits: c.fractionDigits,
    maximumFractionDigits: c.fractionDigits,
  });
  return `${c.symbol}${n}`;
}

/**
 * Decide whether a (JPY, foreign) pair represents a plausible exchange rate
 * for the given currency. Used by the reconcile FX matcher to reject obvious
 * mismatches (e.g. a ¥4,000 card row would never settle a 1 USD pending row).
 *
 * `tripEstRate`, when provided, widens the band to est_rate ± 30 % for
 * unknown currencies so a household with a quirky pick still gets matches.
 */
export function isPlausibleRate(
  jpy: number,
  foreign: number,
  code: string,
  tripEstRate?: number,
): boolean {
  if (foreign <= 0 || jpy <= 0) return false;
  const rate = jpy / foreign;
  const c = getCurrency(code);
  const [lo, hi] = c.plausibleJpyRange;
  if (rate >= lo && rate <= hi) return true;
  if (tripEstRate && tripEstRate > 0) {
    return rate >= tripEstRate * 0.7 && rate <= tripEstRate * 1.3;
  }
  return false;
}
