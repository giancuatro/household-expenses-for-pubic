import { STOCK_LIST } from "@/lib/stockList";

export type LivePrice = {
  ticker: string;
  price: number;
  currency: "USD" | "JPY";
  priceUnit: number;
  timestamp: string;
};

/**
 * Server-side live-price fetcher used by the API route AND directly by
 * server components for SSR prefetch. Falls back to null on any failure.
 */
export async function fetchLivePrice(ticker: string): Promise<LivePrice | null> {
  const item = STOCK_LIST.find(
    (s) => s.ticker.toLowerCase() === ticker.toLowerCase(),
  );
  const yahooTicker = item?.yahooTicker ?? ticker;
  const stockType = item?.type ?? "US";
  const priceUnit = item?.priceUnit ?? 1;

  try {
    if (stockType === "fund") {
      const price = await scrapeFundNav(yahooTicker);
      if (price == null) return null;
      return { ticker, price, currency: "JPY", priceUnit, timestamp: new Date().toISOString() };
    }
    return await fetchYahooChart(ticker, yahooTicker, stockType, priceUnit);
  } catch {
    return null;
  }
}

export async function fetchLivePrices(tickers: string[]): Promise<Map<string, LivePrice>> {
  const unique = Array.from(new Set(tickers));
  const out = new Map<string, LivePrice>();
  const results = await Promise.all(unique.map(async (t) => ({ t, p: await fetchLivePrice(t) })));
  for (const { t, p } of results) {
    if (p) out.set(t, p);
  }
  return out;
}

async function fetchYahooChart(
  ticker: string,
  yahooTicker: string,
  stockType: string,
  priceUnit: number,
): Promise<LivePrice | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    yahooTicker,
  )}?range=1d&interval=1d`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
    next: { revalidate: 300 },
  });
  if (!res.ok) return null;
  const json = await res.json();
  const meta = json?.chart?.result?.[0]?.meta;
  if (!meta || typeof meta.regularMarketPrice !== "number") return null;
  const currency = stockType === "JP" ? "JPY" : (meta.currency ?? "USD");
  return {
    ticker,
    price: meta.regularMarketPrice,
    currency: currency === "JPY" ? "JPY" : "USD",
    priceUnit,
    timestamp: new Date().toISOString(),
  };
}

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
      // try next
    }
  }
  return null;
}

function parseFundNav(html: string): number | null {
  const patterns: RegExp[] = [
    /PriceBoard__price[^"]*"[\s\S]{0,400}?StyledNumber__value[^>]*>\s*([0-9][0-9,]{2,})\s*</,
    /PriceBoard__price[^>]*>\s*<[^>]*>\s*([0-9][0-9,]{3,})\s*</,
    /基準価額[\s\S]{0,400}?<[^>]+>\s*([0-9][0-9,]{3,})\s*<\/[^>]+>\s*円/,
    /基準価額[^0-9]{0,200}([0-9][0-9,]{3,})\s*円/,
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
