import type { InvestmentHoldingRow, InvestmentTransactionRow } from "@/lib/types";
import { getPriceUnit } from "@/lib/stockList";

export type Granularity = "monthly" | "daily";

export type AssetSeriesRow = {
  /** YYYY-MM for monthly, YYYY-MM-DD for daily. Used as XAxis dataKey. */
  date: string;
  total: number;
  [ticker: string]: number | string;
};

export type TickerMeta = {
  ticker: string;
  name: string;
};

type StockHistoryResponse = {
  ticker?: string;
  interval?: string;
  points?: { date: string; price: number }[];
  /** Legacy field for monthly responses. */
  months?: { month: string; price: number }[];
  error?: string;
};

/**
 * Reconstruct holdings over time and value them at the appropriate price per period.
 *
 * Quantities are replayed from `trades` so each row reflects what was actually held
 * at that point in time (not the current snapshot). FX rate uses the latest known
 * rate per ticker (from holdings, falling back to the most recent trade).
 *
 * Daily granularity carries forward the last known price for weekends/holidays so the
 * series is continuous. Months earlier than a ticker's first trade are 0.
 *
 * If `livePrices` is provided, an additional "today" data point is appended whose
 * value uses the live price per ticker — this keeps the chart's right-most value
 * consistent with the live total displayed on the investment tab. (Without this,
 * the chart's latest point is yesterday's close (daily) or last-month close
 * (monthly), causing a visible mismatch.)
 */
export async function buildAssetHistory({
  trades,
  holdings,
  granularity = "monthly",
  fromDate,
  livePrices,
}: {
  trades: InvestmentTransactionRow[];
  holdings: InvestmentHoldingRow[];
  granularity?: Granularity;
  /** Optional cutoff: only generate rows from this date forward (YYYY-MM or YYYY-MM-DD). */
  fromDate?: string;
  /** Optional live prices per ticker (USD or JPY, before priceUnit normalization). */
  livePrices?: Map<string, number>;
}): Promise<{ rows: AssetSeriesRow[]; tickers: TickerMeta[] }> {
  const allTickers = new Set<string>();
  for (const t of trades) allTickers.add(t.ticker);
  for (const h of holdings) allTickers.add(h.ticker);
  if (allTickers.size === 0) return { rows: [], tickers: [] };

  const earliestByTicker = new Map<string, string>(); // YYYY-MM-DD per ticker
  for (const t of trades) {
    const cur = earliestByTicker.get(t.ticker);
    if (!cur || t.date < cur) earliestByTicker.set(t.ticker, t.date);
  }

  const nameByTicker = new Map<string, string>();
  const fxByTicker = new Map<string, number>();
  for (const h of holdings) {
    if (h.name) nameByTicker.set(h.ticker, h.name);
    if (h.exchange_rate) fxByTicker.set(h.ticker, h.exchange_rate);
  }
  const tradesDesc = [...trades].sort((a, b) => b.date.localeCompare(a.date));
  for (const t of tradesDesc) {
    if (!nameByTicker.has(t.ticker) && t.name) nameByTicker.set(t.ticker, t.name);
    if (!fxByTicker.has(t.ticker) && t.exchange_rate) fxByTicker.set(t.ticker, t.exchange_rate);
  }

  const fallbackPriceByTicker = new Map<string, number>();
  for (const h of holdings) {
    if (h.current_price_usd) fallbackPriceByTicker.set(h.ticker, h.current_price_usd);
  }

  // Fetch price history for each ticker at the requested granularity, in parallel.
  const interval = granularity === "daily" ? "1d" : "1mo";
  const tickers = [...allTickers];
  const priceFetches = await Promise.all(
    tickers.map(async (ticker) => {
      const earliestForTicker = earliestByTicker.get(ticker) ?? "";
      const from = fromDate && fromDate > earliestForTicker ? fromDate : earliestForTicker;
      const fromParam = granularity === "monthly" ? from.slice(0, 7) : from;
      try {
        const res = await fetch(
          `/api/stock-history?ticker=${encodeURIComponent(ticker)}&from=${encodeURIComponent(fromParam)}&interval=${interval}`
        );
        if (!res.ok) return { ticker, points: [] as { date: string; price: number }[] };
        const data: StockHistoryResponse = await res.json();
        return { ticker, points: data.points ?? [] };
      } catch {
        return { ticker, points: [] as { date: string; price: number }[] };
      }
    })
  );

  // Per-ticker sorted price points.
  const pointsByTicker = new Map<string, { date: string; price: number }[]>();
  for (const { ticker, points } of priceFetches) {
    pointsByTicker.set(
      ticker,
      [...points].sort((a, b) => a.date.localeCompare(b.date))
    );
  }

  // Determine the date axis.
  const earliestOverall = [...earliestByTicker.values()].sort()[0];
  if (!earliestOverall) return { rows: [], tickers: [] };
  const today = new Date();
  let axis: string[];
  if (granularity === "monthly") {
    // Up to the previous calendar month — current month not yet realized.
    const prevCal = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const endMonth = `${prevCal.getFullYear()}-${String(prevCal.getMonth() + 1).padStart(2, "0")}`;
    const startMonth = (fromDate && fromDate > earliestOverall ? fromDate : earliestOverall).slice(0, 7);
    axis = listMonths(startMonth, endMonth);
  } else {
    // Daily: from the requested start date through yesterday.
    const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
    const endIso = isoOf(yesterday);
    const startIso = fromDate && fromDate > earliestOverall ? fromDate : earliestOverall;
    axis = listDays(startIso, endIso);
  }
  if (axis.length === 0) return { rows: [], tickers: [] };

  // For each ticker, walk the price points in order and resolve each axis entry to a price.
  // For daily we carry the last known price forward over weekends/holidays.
  // For monthly we use the price whose date matches the month (any day in that month is fine; API returns one per month).
  const resolvedPriceByTicker = new Map<string, Map<string, number>>();
  for (const ticker of tickers) {
    const pts = pointsByTicker.get(ticker) ?? [];
    const map = new Map<string, number>();
    if (granularity === "monthly") {
      for (const p of pts) map.set(p.date.slice(0, 7), p.price);
    } else {
      // Daily: build YYYY-MM-DD -> price, then forward-fill across the axis.
      const exact = new Map<string, number>();
      for (const p of pts) exact.set(p.date, p.price);
      let last: number | undefined;
      for (const day of axis) {
        const v = exact.get(day);
        if (v !== undefined) last = v;
        if (last !== undefined) map.set(day, last);
      }
    }
    resolvedPriceByTicker.set(ticker, map);
  }

  // Now compute rows.
  const rows: AssetSeriesRow[] = [];
  for (const key of axis) {
    const replayUpTo = granularity === "monthly" ? lastDayOfMonth(key) : key;
    const row: AssetSeriesRow = { date: key, total: 0 };
    for (const ticker of tickers) {
      const earliest = earliestByTicker.get(ticker);
      if (!earliest || key < earliest.slice(0, key.length)) {
        row[ticker] = 0;
        continue;
      }
      const quantity = quantityAt(trades, ticker, replayUpTo);
      if (quantity <= 0) {
        row[ticker] = 0;
        continue;
      }
      const priceUnit = getPriceUnit(ticker);
      const price = resolvedPriceByTicker.get(ticker)?.get(key) ?? fallbackPriceByTicker.get(ticker);
      if (price === undefined) {
        row[ticker] = 0;
        continue;
      }
      const fx = fxByTicker.get(ticker) ?? 1;
      const value = Math.round((quantity * price * fx) / priceUnit);
      row[ticker] = value;
      row.total += value;
    }
    rows.push(row);
  }

  // If live prices are available, append (or overwrite) a final row keyed
  // to "today" (daily) or the current month (monthly).
  //
  // CRITICAL: this row must agree EXACTLY with the investment tab's
  // "current total" (InvestmentClient → holdingValueJpy summed). The earlier
  // approach replayed trades to derive today's quantity, which silently
  // diverged from the investment tab whenever:
  //   - a holding row was manually edited / recalculated and its quantity
  //     no longer matched a pure replay of the buy/sell history,
  //   - the same ticker existed in multiple accounts with different
  //     exchange_rate values (replay-based code picked ONE fx per ticker
  //     instead of summing per-account at each account's own fx).
  //
  // The fix: use the holdings snapshot directly — the same data the
  // investment tab uses — deduped to the latest row per (account, ticker).
  // The replay logic stays for historical rows; only the right-most "live"
  // point switches to holdings-derived.
  if (livePrices && livePrices.size > 0) {
    const todayKey = (() => {
      if (granularity === "monthly") {
        return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
      }
      return isoOf(today);
    })();

    // Dedupe holdings → latest per (account_id, ticker). holdings are
    // expected pre-sorted by fetched_at desc by the queries layer; we
    // re-sort defensively so this function never depends on caller order.
    const sortedHoldings = [...holdings].sort((a, b) => b.fetched_at.localeCompare(a.fetched_at));
    const seenAcctTicker = new Set<string>();
    const latestHoldings = sortedHoldings.filter((h) => {
      const k = `${h.account_id}::${h.ticker}`;
      if (seenAcctTicker.has(k)) return false;
      seenAcctTicker.add(k);
      return true;
    });

    const liveRow: AssetSeriesRow = { date: todayKey, total: 0 };
    for (const ticker of tickers) liveRow[ticker] = 0;

    for (const h of latestHoldings) {
      if (h.quantity <= 0) continue;
      const priceUnit = getPriceUnit(h.ticker);
      const price =
        livePrices.get(h.ticker) ??
        h.current_price_usd ??
        resolvedPriceByTicker.get(h.ticker)?.get(todayKey);
      if (price === undefined || price === null) continue;
      // Mirrors investment tab's holdingValueJpy(h, live):
      //   round((quantity × price) / priceUnit × exchange_rate)
      const value = Math.round((h.quantity * price) / priceUnit * h.exchange_rate);
      liveRow[h.ticker] = ((liveRow[h.ticker] as number) ?? 0) + value;
      liveRow.total += value;
    }

    const existingIdx = rows.findIndex((r) => r.date === todayKey);
    if (existingIdx >= 0) rows[existingIdx] = liveRow;
    else rows.push(liveRow);
  }

  const tickerMetas: TickerMeta[] = tickers
    .map((ticker) => ({
      ticker,
      name: nameByTicker.get(ticker) ?? ticker,
      _firstAcq: earliestByTicker.get(ticker) ?? "9999-99-99",
    }))
    .sort((a, b) => a._firstAcq.localeCompare(b._firstAcq))
    .map(({ ticker, name }) => ({ ticker, name }));

  return { rows, tickers: tickerMetas };
}

function quantityAt(trades: InvestmentTransactionRow[], ticker: string, dateInclusive: string): number {
  let qty = 0;
  for (const t of trades) {
    if (t.ticker !== ticker) continue;
    if (t.date > dateInclusive) continue;
    qty += t.action === "buy" ? t.quantity : -t.quantity;
  }
  return qty;
}

function lastDayOfMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return `${ym}-${String(last).padStart(2, "0")}`;
}

function listMonths(from: string, to: string): string[] {
  const out: string[] = [];
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  let y = fy;
  let m = fm;
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

function isoOf(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function listDays(from: string, to: string): string[] {
  const out: string[] = [];
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const start = new Date(fy, fm - 1, fd);
  const end = new Date(ty, tm - 1, td);
  for (let d = start; d <= end; d.setDate(d.getDate() + 1)) {
    out.push(isoOf(d));
  }
  return out;
}
