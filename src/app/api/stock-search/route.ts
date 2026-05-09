import { NextRequest } from "next/server";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") ?? "";
  if (!q || q.length < 1) return Response.json([]);

  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&lang=en-US&region=US&quotesCount=8&newsCount=0&listsCount=0`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      next: { revalidate: 300 }, // 5-minute cache
    });
    const data = await res.json();
    const quotes = (data.quotes ?? [])
      .filter((item: { quoteType?: string }) =>
        item.quoteType === "EQUITY" || item.quoteType === "ETF"
      )
      .map((item: { symbol: string; longname?: string; shortname?: string }) => ({
        ticker: item.symbol,
        name: item.longname || item.shortname || item.symbol,
        type: "US" as const,
      }));
    return Response.json(quotes);
  } catch {
    return Response.json([]);
  }
}
