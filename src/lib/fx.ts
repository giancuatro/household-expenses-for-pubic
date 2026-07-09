/**
 * Convert a foreign-currency amount to JPY for storage. `transactions.amount`
 * is always a positive JPY integer, so we round and clamp to at least ¥1.
 * Extracted as a pure function so the FX rounding rule can be unit-tested
 * independently of the server action.
 */
export function computeFxAmount(originalAmount: number, fxRate: number): number {
  return Math.max(1, Math.round(originalAmount * fxRate));
}
