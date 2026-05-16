import { getSupabaseServer } from "@/lib/supabase/server";
import { listUsers } from "@/lib/queries";
import { requireSession } from "@/lib/auth";
import { fetchLivePricesWithTimeout, type LivePrice } from "@/lib/stockPrice";
import InvestmentClient from "./InvestmentClient";
import type { InvestmentHoldingRow } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function InvestmentPage() {
  const { household } = await requireSession();
  const hid = household.household_id;
  const sb = getSupabaseServer();
  const [users, accountsRes, tradesRes, holdingsRes] = await Promise.all([
    listUsers(hid),
    sb
      .from("investment_accounts")
      .select("*")
      .eq("household_id", hid)
      .order("created_at"),
    sb
      .from("investment_transactions")
      .select("*")
      .eq("household_id", hid)
      .order("date", { ascending: false }),
    sb
      .from("investment_holdings")
      .select("*")
      .eq("household_id", hid)
      .order("fetched_at", { ascending: false }),
  ]);

  const latestHoldings = new Map<string, InvestmentHoldingRow>();
  for (const h of (holdingsRes.data ?? []) as InvestmentHoldingRow[]) {
    const key = `${h.account_id}::${h.ticker}`;
    if (!latestHoldings.has(key)) latestHoldings.set(key, h);
  }
  const holdings = Array.from(latestHoldings.values());

  // Prefetch live prices on the server so the table renders with up-to-date
  // values immediately — no client-side flash. Bounded by a hard timeout so
  // a slow Yahoo response can never stall first-byte time; whatever doesn't
  // arrive in time is filled in by the client refresh on mount.
  const tickers = Array.from(new Set(holdings.map((h) => h.ticker)));
  const priceMap = await fetchLivePricesWithTimeout(tickers);
  const initialPrices: Record<string, LivePrice> = {};
  for (const [k, v] of priceMap.entries()) initialPrices[k] = v;

  return (
    <InvestmentClient
      users={users}
      accounts={(accountsRes.data ?? []) as never}
      holdings={holdings}
      trades={(tradesRes.data ?? []) as never}
      initialPrices={initialPrices}
    />
  );
}
