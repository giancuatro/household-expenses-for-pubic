import { getSupabaseServer } from "@/lib/supabase/server";
import { listUsers } from "@/lib/queries";
import { requireSession } from "@/lib/auth";
import InvestmentClient from "./InvestmentClient";

export const dynamic = "force-dynamic";

export default async function InvestmentPage() {
  const { household } = await requireSession();
  const hid = household.household_id;
  const sb = getSupabaseServer();
  const [users, accountsRes, tradesRes] = await Promise.all([
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
  ]);

  const { data: holdings } = await sb
    .from("investment_holdings")
    .select("*")
    .eq("household_id", hid)
    .order("fetched_at", { ascending: false });

  const latestHoldings = new Map<string, any>();
  for (const h of holdings ?? []) {
    const key = `${h.account_id}::${h.ticker}`;
    if (!latestHoldings.has(key)) latestHoldings.set(key, h);
  }

  return (
    <InvestmentClient
      users={users}
      accounts={(accountsRes.data ?? []) as any}
      holdings={Array.from(latestHoldings.values())}
      trades={(tradesRes.data ?? []) as any}
    />
  );
}
