import { NextRequest, NextResponse } from "next/server";
import { STOCK_LIST } from "@/lib/stockList";

/**
 * GET /api/stock-price?ticker=MSFT
 *
 * Returns:
 *   { ticker, price, currency, priceUnit, timestamp }
 *
 * - US stocks: price in USD, priceUnit=1
 * - JP stocks: price in JPY, priceUnit=1
 * - JP mutual funds: price is NAV per 万口 in JPY, priceUnit=10000
 *   (e.g. price=20000 means ¥20,000 per 10,000 units)
 */
export async function GET(req: NextRequest) {
  const ticker = req.nextUrl.searchParams.get("ticker")?.trim();
  if (!ticker) return NextResponse.json({ error: "ticker required" }, { status: 400 });

  const item = STOCK_LIST.find(
    (s) => s.ticker.toLowerCase() === ticker.toLowerCase()
  );
  const yahooTicker = item?.yahooTicker ?? ticker;
  const stockType = item?.type ?? "US";
  const priceUnit = item?.priceUnit ?? 1;

  try {
    if (stockType === "fund") {
      return await fetchFundPrice(ticker, yahooTicker, priceUnit);
    }
    return await fetchYahooChart(ticker, yahooTicker, stockType, priceUnit);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg });
  }
}

async function fetchYahooChart(
  ticker: string,
  yahooTicker: string,
  stockType: string,
  priceUnit: number
) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooTicker)}?range=1d&interval=1d`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
    next: { revalidate: 300 }, // cache 5 min
  });
  if (!res.ok) {
    return NextResponse.json({ error: `Yahoo returned ${res.status}` });
  }
  const json = await res.json();
  const meta = json?.chart?.result?.[0]?.meta;
  if (!meta) return NextResponse.json({ error: "No data from Yahoo" });

  const currency = stockType === "JP" ? "JPY" : (meta.currency ?? "USD");

  return NextResponse.json({
    ticker,
    price: meta.regularMarketPrice,
    currency,
    priceUnit,
    timestamp: new Date().toISOString(),
  });
}

async function fetchFundPrice(ticker: string, fundCode: string, priceUnit: number) {
  const price = await scrapeFundNav(fundCode);
  if (price != null) {
    return NextResponse.json({
      ticker,
      price,          // NAV per 万口 (e.g. 20000)
      currency: "JPY",
      priceUnit,      // 10000 — callers divide price/priceUnit to get per-unit value
      timestamp: new Date().toISOString(),
    });
  }
  return NextResponse.json({ error: "Could not parse fund price" });
}

/**
 * Scrape fund NAV (基準価額) in JPY per 10,000 units from public sources.
 * Tries Yahoo Japan Finance first, then minkabu as a fallback since the
 * Yahoo fund page markup changes regularly.
 */
async function scrapeFundNav(fundCode: string): Promise<number | null> {
  const sources = [
    `https://finance.yahoo.co.jp/quote/${fundCode}`,
    `https://finance.yahoo.co.jp/fund/detail/${fundCode}`,
    `https://itf.minkabu.jp/fund/${fundCode}`,
  ];
  for (const url of sources) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          "Accept-Language": "ja,en-US;q=0.9",
        },
        next: { revalidate: 900 },
      });
      if (!res.ok) continue;
      const html = await res.text();
      const price = parseFundNav(html);
      if (price != null) return price;
    } catch {
      // try next source
    }
  }
  return null;
}

/**
 * Extract a fund NAV number from an HTML page. Tries several patterns because
 * the Yahoo Japan fund page layout is changed frequently and without notice.
 * Expected value range: 1,000 – 999,999 JPY (per 万口).
 */
function parseFundNav(html: string): number | null {
  const patterns: RegExp[] = [
    // Yahoo Japan quote page (2024+ layout):
    //   <span class="...PriceBoard__price...">...StyledNumber__value...">33,558</span>
    /PriceBoard__price[^"]*"[\s\S]{0,400}?StyledNumber__value[^>]*>\s*([0-9][0-9,]{2,})\s*</,
    // Older Yahoo layout with inline number span
    /PriceBoard__price[^>]*>\s*<[^>]*>\s*([0-9][0-9,]{3,})\s*</,
    // minkabu pattern: "<span>20,000</span> 円"
    /基準価額[\s\S]{0,400}?<[^>]+>\s*([0-9][0-9,]{3,})\s*<\/[^>]+>\s*円/,
    // Generic: "基準価額 ... NUMBER 円"
    /基準価額[^0-9]{0,200}([0-9][0-9,]{3,})\s*円/,
    // JSON-ish blob
    /"price"\s*:\s*"?([0-9]{4,}(?:\.[0-9]+)?)"?/,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (!m) continue;
    const n = parseInt(m[1].replace(/,/g, ""), 10);
    if (Number.isFinite(n) && n >= 1000 && n <= 999999) return n;
  }
  return null;
}
