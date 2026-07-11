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

export interface TradeLike {
  ticker: string;
  name?: string | null;
  action: "buy" | "sell";
  quantity: number;
  price_usd: number;
  exchange_rate: number;
}

export interface ReducedPosition {
  ticker: string;
  name: string;
  /** Net shares/units still held (never negative). */
  qty: number;
  /** Weighted-average cost in the trade's native price unit. */
  avgCostUsd: number;
  /** Exchange rate of the most recent trade for this ticker. */
  rate: number;
}

/**
 * Replay one account's trades into current positions. Buys add to quantity and
 * cost; sells reduce both proportionally. `trades` MUST be pre-sorted oldest-
 * first (the DB query orders by date) — average cost is path-dependent.
 *
 * A sell that exceeds the running position is the signature of the phantom-
 * holding bug: the shares were bought in a *different* account, so this account
 * can't cover the sell. We clamp quantity to zero (as before) but also emit a
 * warning instead of swallowing it silently — that silent clamp is exactly how
 * a sell filed against the wrong account left the buy side stranded as a ghost
 * position. Positions that net to zero are dropped from the result.
 */
export function reduceHoldingsFromTrades(trades: TradeLike[]): {
  positions: ReducedPosition[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const map = new Map<string, { name: string; qty: number; totalCost: number; rate: number }>();
  for (const t of trades) {
    const prev = map.get(t.ticker) ?? { name: t.name ?? t.ticker, qty: 0, totalCost: 0, rate: t.exchange_rate };
    if (t.action === "buy") {
      prev.totalCost += t.quantity * t.price_usd;
      prev.qty += t.quantity;
    } else {
      if (t.quantity > prev.qty + 1e-9) {
        warnings.push(
          `${prev.name}: この口座の保有(${prev.qty})を超える売却(${t.quantity})があります。買付が別口座にないか確認してください。`,
        );
      }
      const newQty = Math.max(0, prev.qty - t.quantity);
      if (prev.qty > 0) prev.totalCost = prev.totalCost * (newQty / prev.qty);
      prev.qty = newQty;
    }
    prev.rate = t.exchange_rate;
    map.set(t.ticker, prev);
  }
  const positions: ReducedPosition[] = [];
  for (const [ticker, pos] of map.entries()) {
    if (pos.qty <= 1e-9) continue;
    positions.push({
      ticker,
      name: pos.name,
      qty: pos.qty,
      avgCostUsd: pos.qty > 0 ? pos.totalCost / pos.qty : 0,
      rate: pos.rate,
    });
  }
  return { positions, warnings };
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
