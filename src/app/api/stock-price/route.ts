import { NextRequest, NextResponse } from "next/server";
import { fetchLivePrice } from "@/lib/stockPrice";
import { getAuthUser } from "@/lib/auth";

// Keep the regex in sync with /api/stock-history. Underscore covers fund
// ids (SBI_WORLD, DAIWA_NDX); 16-char cap covers longer broker codes.
const TICKER_RE = /^[A-Za-z0-9._\-]{1,16}$/;

/**
 * GET /api/stock-price?ticker=MSFT
 *
 * - US stocks: price in USD, priceUnit=1
 * - JP stocks: price in JPY, priceUnit=1
 * - JP mutual funds: price = NAV per 万口 (priceUnit=10000)
 *
 * Auth gate prevents unauthenticated abuse of our outbound bandwidth and
 * keeps the upstream Yahoo Finance call from being weaponized as a free SSRF
 * proxy. Ticker shape is locked down to a strict alphanumeric range.
 */
export async function GET(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const ticker = req.nextUrl.searchParams.get("ticker")?.trim();
  if (!ticker) return NextResponse.json({ error: "ticker required" }, { status: 400 });
  if (!TICKER_RE.test(ticker)) return NextResponse.json({ error: "invalid ticker" }, { status: 400 });

  const price = await fetchLivePrice(ticker);
  if (!price) return NextResponse.json({ error: "Could not fetch price" });
  return NextResponse.json(price);
}
