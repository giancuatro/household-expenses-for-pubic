import { NextRequest, NextResponse } from "next/server";
import { fetchLivePrice } from "@/lib/stockPrice";

/**
 * GET /api/stock-price?ticker=MSFT
 *
 * - US stocks: price in USD, priceUnit=1
 * - JP stocks: price in JPY, priceUnit=1
 * - JP mutual funds: price = NAV per 万口 (priceUnit=10000)
 */
export async function GET(req: NextRequest) {
  const ticker = req.nextUrl.searchParams.get("ticker")?.trim();
  if (!ticker) return NextResponse.json({ error: "ticker required" }, { status: 400 });

  const price = await fetchLivePrice(ticker);
  if (!price) return NextResponse.json({ error: "Could not fetch price" });
  return NextResponse.json(price);
}
