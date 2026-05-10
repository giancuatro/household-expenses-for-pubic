import { NextRequest, NextResponse } from "next/server";
import { STOCK_LIST } from "@/lib/stockList";
import { getAuthUser } from "@/lib/auth";

const TICKER_RE = /^[A-Za-z0-9.\-]{1,12}$/;
const FROM_RE = /^\d{4}-\d{2}(-\d{2})?$/;

/**
 * GET /api/stock-history?ticker=MSFT&from=2023-01&interval=1mo
 *
 * Returns closing prices from `from` (YYYY-MM or YYYY-MM-DD) through the latest available bar.
 * `interval` may be `1d`, `1wk`, or `1mo` (default `1mo`).
 *
 * Response:
 *   { ticker, currency, priceUnit, interval, points: [{date: "YYYY-MM-DD", price: 350.0}, ...] }
 *
 * For backwards compatibility, when interval=1mo the response also includes a `months` array
 * of `{month, price}` (existing callers that use month-only keys keep working).
 *
 * Price semantics match /api/stock-price:
 *   - US stocks: USD per share
 *   - JP stocks: JPY per share
 *   - JP mutual funds: JPY per 万口 (priceUnit=10000)
 */
type Interval = "1d" | "1wk" | "1mo";
const VALID_INTERVALS: Interval[] = ["1d", "1wk", "1mo"];

export async function GET(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const ticker = req.nextUrl.searchParams.get("ticker")?.trim();
  const from = req.nextUrl.searchParams.get("from")?.trim(); // YYYY-MM or YYYY-MM-DD
  const intervalParam = req.nextUrl.searchParams.get("interval")?.trim() as Interval | undefined;
  const interval: Interval = VALID_INTERVALS.includes(intervalParam as Interval) ? (intervalParam as Interval) : "1mo";
  if (!ticker) return NextResponse.json({ error: "ticker required" }, { status: 400 });
  if (!TICKER_RE.test(ticker)) return NextResponse.json({ error: "invalid ticker" }, { status: 400 });
  if (from && !FROM_RE.test(from)) return NextResponse.json({ error: "invalid from" }, { status: 400 });

  const item = STOCK_LIST.find((s) => s.ticker.toLowerCase() === ticker.toLowerCase());
  const yahooTicker = item?.yahooTicker ?? ticker;
  const stockType = item?.type ?? "US";
  const priceUnit = item?.priceUnit ?? 1;
  const currency = stockType === "US" ? "USD" : "JPY";

  try {
    if (stockType === "fund") {
      return await fetchFundHistory(ticker, yahooTicker, from ?? null, priceUnit, interval);
    }
    return await fetchYahooHistory(ticker, yahooTicker, from ?? null, stockType, priceUnit, currency, interval);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg });
  }
}

/** Pick a Yahoo `range` value that comfortably covers `from` for the given interval. */
function pickRange(from: string | null, interval: Interval): string {
  if (interval === "1mo") return "10y"; // existing behavior
  // For daily/weekly we don't want to fetch 10y of daily bars. Cap at the requested range.
  const now = new Date();
  if (!from) return interval === "1d" ? "1y" : "5y";
  const fromDate = new Date(from + (from.length === 7 ? "-01" : ""));
  const days = Math.max(1, Math.floor((now.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24)));
  if (interval === "1d") {
    if (days <= 30) return "1mo";
    if (days <= 90) return "3mo";
    if (days <= 180) return "6mo";
    if (days <= 365) return "1y";
    if (days <= 730) return "2y";
    if (days <= 1825) return "5y";
    return "10y";
  }
  // 1wk
  if (days <= 365) return "1y";
  if (days <= 1825) return "5y";
  return "10y";
}

function isoFromTimestamp(ts: number): string {
  const d = new Date(ts * 1000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Truncate a YYYY-MM-DD to YYYY-MM. */
function ymOf(date: string): string {
  return date.slice(0, 7);
}

function buildResponse(
  ticker: string,
  currency: string,
  priceUnit: number,
  interval: Interval,
  points: { date: string; price: number }[]
) {
  // Keep the legacy `months` array on monthly responses so existing callers don't break.
  if (interval === "1mo") {
    const months = points.map((p) => ({ month: ymOf(p.date), price: p.price }));
    return NextResponse.json({ ticker, currency, priceUnit, interval, points, months });
  }
  return NextResponse.json({ ticker, currency, priceUnit, interval, points });
}

async function fetchYahooHistory(
  ticker: string,
  yahooTicker: string,
  from: string | null,
  stockType: string,
  priceUnit: number,
  currency: string,
  interval: Interval
) {
  const range = pickRange(from, interval);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooTicker)}?range=${range}&interval=${interval}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
    next: { revalidate: interval === "1d" ? 600 : 3600 },
  });
  if (!res.ok) return NextResponse.json({ error: `Yahoo returned ${res.status}` });

  const json = await res.json();
  const result = json?.chart?.result?.[0];
  if (!result) return NextResponse.json({ error: "No data from Yahoo" });

  const timestamps: number[] = result.timestamp ?? [];
  const closes: number[] = result.indicators?.quote?.[0]?.close ?? [];
  const actualCurrency = stockType === "JP" ? "JPY" : (result.meta?.currency ?? "USD");

  const points: { date: string; price: number }[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const price = closes[i];
    if (price == null || isNaN(price)) continue;
    const date = isoFromTimestamp(timestamps[i]);
    if (from && (from.length === 7 ? ymOf(date) < from : date < from)) continue;
    points.push({ date, price });
  }

  return buildResponse(ticker, actualCurrency, priceUnit, interval, points);
}

async function fetchFundHistory(
  ticker: string,
  fundCode: string,
  from: string | null,
  priceUnit: number,
  interval: Interval
) {
  const range = pickRange(from, interval);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(fundCode)}.T?range=${range}&interval=${interval}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
    next: { revalidate: interval === "1d" ? 600 : 3600 },
  });

  if (res.ok) {
    const json = await res.json();
    const result = json?.chart?.result?.[0];
    if (result) {
      const timestamps: number[] = result.timestamp ?? [];
      const closes: number[] = result.indicators?.quote?.[0]?.close ?? [];
      const points: { date: string; price: number }[] = [];
      for (let i = 0; i < timestamps.length; i++) {
        const price = closes[i];
        if (price == null || isNaN(price)) continue;
        const date = isoFromTimestamp(timestamps[i]);
        if (from && (from.length === 7 ? ymOf(date) < from : date < from)) continue;
        // Fund prices from Yahoo Finance Japan are typically per unit, but NAV pages show per 万口
        // Multiply by 10000 to convert to per-万口 to match our storage format
        points.push({ date, price: price * priceUnit });
      }
      if (points.length > 0) {
        return buildResponse(ticker, "JPY", priceUnit, interval, points);
      }
    }
  }

  // Fallback: try Yahoo Japan fund page for current NAV only
  // (no historical data available this way, return empty)
  return buildResponse(ticker, "JPY", priceUnit, interval, []);
}
