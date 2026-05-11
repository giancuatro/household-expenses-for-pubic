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
import { fetchLivePrices, type LivePrice } from "@/lib/stockPrice";
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
  // This guarantees the asset-trend chart's right edge agrees with the
  // investment tab's headline total from the first paint, instead of waiting
  // for a client-side fetch to populate.
  const trades = (tradesRes.data ?? []) as InvestmentTransactionRow[];
  const tickers = Array.from(new Set([...holdings.map((h) => h.ticker), ...trades.map((t) => t.ticker)]));
  const priceMap = await fetchLivePrices(tickers);
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
