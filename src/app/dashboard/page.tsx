import { getSupabaseServer } from "@/lib/supabase/server";
import {
  listAllTransactions,
  listCategories,
  listUsers,
  listPaymentMethods,
  listCashBalanceSnapshots,
  listFixedCostMasters,
} from "@/lib/queries";
import { requireSession } from "@/lib/auth";
import { fetchLivePricesWithTimeout, type LivePrice } from "@/lib/stockPrice";
import DashboardClient from "./DashboardClient";
import type { InvestmentHoldingRow, InvestmentTransactionRow } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const { household } = await requireSession();
  const hid = household.household_id;
  const sb = getSupabaseServer();

  const [users, categories, txns, paymentMethods, cashSnapshots, fixedCostMasters, tradesRes, holdingsRes] =
    await Promise.all([
      listUsers(hid),
      listCategories(hid),
      listAllTransactions(hid),
      listPaymentMethods(hid).catch(() => []),
      listCashBalanceSnapshots(hid).catch(() => []),
      listFixedCostMasters(hid).catch(() => []),
      sb
        .from("investment_transactions")
        .select("*")
        .eq("household_id", hid)
        .order("date", { ascending: true }),
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

  // SSR-prefetch live prices using the same helper the investment tab uses.
  // Bounded by a timeout — we'd rather show a slightly stale chart for one
  // beat than block first-byte time on a slow upstream. The client refreshes
  // on mount so any missing tickers fill in within ~1s after paint.
  const trades = (tradesRes.data ?? []) as InvestmentTransactionRow[];
  const tickers = Array.from(new Set([...holdings.map((h) => h.ticker), ...trades.map((t) => t.ticker)]));
  const priceMap = await fetchLivePricesWithTimeout(tickers);
  const initialPrices: Record<string, LivePrice> = {};
  for (const [k, v] of priceMap.entries()) initialPrices[k] = v;

  return (
    <DashboardClient
      users={users}
      categories={categories}
      transactions={txns}
      paymentMethods={paymentMethods}
      cashSnapshots={cashSnapshots}
      fixedCostMasters={fixedCostMasters}
      holdings={holdings}
      trades={trades}
      initialPrices={initialPrices}
    />
  );
}
