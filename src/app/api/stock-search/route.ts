import { NextRequest } from "next/server";
import { getAuthUser } from "@/lib/auth";

const Q_RE = /^[A-Za-z0-9.\-\s]{1,32}$/;

export async function GET(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (!q) return Response.json([]);
  if (!Q_RE.test(q)) return Response.json({ error: "invalid query" }, { status: 400 });

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
