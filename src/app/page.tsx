import {
  listCashBalanceSnapshots,
  listCategories,
  listConfirmedBills,
  listFixedCostMasters,
  listKindColors,
  listPaymentMethods,
  listTransactionsForMonth,
  listTransactionsSince,
  listUsers,
  getActiveTrip,
} from "@/lib/queries";
import { addMonths, monthKey } from "@/lib/format";
import { cashFlowWindowStart } from "@/lib/cashFlow";
import { ensureFixedCostsApplied } from "@/lib/fixedCosts";
import { requireSession } from "@/lib/auth";
import HomeClient from "./HomeClient";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const { household } = await requireSession();
  const hid = household.household_id;
  const showOnboarding =
    household.role === "owner" && !household.household.onboarding_completed_at;
  const ym = monthKey();
  const prevYm = addMonths(ym, -1);

  // The predicted-balance projection only needs transactions back to ~70 days
  // before the latest snapshot (see cashFlowWindowStart), so we resolve the
  // (cached, tiny) snapshots first and bound the main fetch instead of pulling
  // every historical row.
  const cashSnapshots = await listCashBalanceSnapshots(hid).catch(() => []);
  const windowStart = cashFlowWindowStart(cashSnapshots);

  const t0 = Date.now();
  const [
    users,
    categories,
    transactions,
    prevTransactions,
    windowTransactions,
    fixedCostMasters,
    paymentMethods,
    kindColors,
    activeTrip,
    confirmedBills,
  ] = await Promise.all([
    listUsers(hid),
    listCategories(hid),
    listTransactionsForMonth(hid, ym),
    listTransactionsForMonth(hid, prevYm),
    listTransactionsSince(hid, windowStart),
    listFixedCostMasters(hid),
    listPaymentMethods(hid).catch(() => []),
    listKindColors(hid).catch(() => []),
    getActiveTrip(hid).catch(() => null),
    listConfirmedBills(hid).catch(() => []),
    ensureFixedCostsApplied(hid).catch(() => null),
  ]);
  console.log(
    `[perf] home queries ${Date.now() - t0}ms, window rows: ${windowTransactions.length}, since: ${windowStart}`,
  );

  return (
    <HomeClient
      users={users}
      categories={categories}
      transactions={transactions}
      prevTransactions={prevTransactions}
      windowTransactions={windowTransactions}
      fixedCostMasters={fixedCostMasters}
      paymentMethods={paymentMethods}
      confirmedBills={confirmedBills}
      cashSnapshots={cashSnapshots}
      kindColors={kindColors}
      activeTrip={activeTrip}
      showOnboarding={showOnboarding}
      currentMonth={ym}
      defaultUserId={household.household.default_user_id}
      defaultPaymentMethodId={household.household.default_payment_method_id}
    />
  );
}
