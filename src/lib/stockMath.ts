/**
 * Single source of truth for "how much JPY is this holding worth right now".
 *
 * Investment tab, asset-trend chart, and anything else that reports the
 * current value of a holding must call this function with the same inputs.
 * Earlier versions had the chart compute its own value via trade replay,
 * which silently diverged from the investment tab whenever holdings.quantity
 * had been adjusted independently of the trade log, or whenever one ticker
 * spanned multiple accounts at different exchange rates.
 *
 * The formula is:
 *
 *   value = round( (quantity × price) / priceUnit × exchange_rate )
 *
 *   - price comes from the live API when available, else the holding's
 *     stored current_price_usd. (The column name is `_usd` but it stores
 *     JPY-per-万口 for funds and JPY for JP stocks — historical naming.)
 *   - priceUnit comes from the live API when available, else STOCK_LIST.
 *     Funds quote NAV per 10,000 units, hence priceUnit = 10000.
 *   - exchange_rate is per-holding (an account can carry a different rate
 *     for the same ticker, e.g. a tax-deferred sub-account opened at a
 *     different JPY/USD rate).
 */
import type { InvestmentHoldingRow } from "@/lib/types";
import { getPriceUnit } from "@/lib/stockList";

export interface LivePriceLike {
  price: number;
  priceUnit?: number;
}

export function holdingValueJpy(h: InvestmentHoldingRow, live?: LivePriceLike): number {
  const priceUnit = live?.priceUnit ?? getPriceUnit(h.ticker);
  const price = live?.price ?? h.current_price_usd;
  return Math.round((h.quantity * price) / priceUnit * h.exchange_rate);
}

/**
 * Sum live values per ticker across (account, ticker) pairs. Useful for
 * chart layers that need a per-ticker breakdown rather than a grand total.
 *
 * `holdings` should already be deduped to "latest per (account, ticker)";
 * see the queries layer for how that's enforced.
 */
export function sumLiveValuesByTicker(
  holdings: InvestmentHoldingRow[],
  livePrices: Map<string, LivePriceLike>,
): { total: number; byTicker: Map<string, number> } {
  let total = 0;
  const byTicker = new Map<string, number>();
  for (const h of holdings) {
    if (h.quantity <= 0) continue;
    const value = holdingValueJpy(h, livePrices.get(h.ticker));
    total += value;
    byTicker.set(h.ticker, (byTicker.get(h.ticker) ?? 0) + value);
  }
  return { total, byTicker };
}
