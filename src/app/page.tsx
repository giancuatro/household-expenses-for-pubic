import {
  listAllTransactions,
  listCashBalanceSnapshots,
  listCategories,
  listFixedCostMasters,
  listKindColors,
  listPaymentMethods,
  listTransactionsForMonth,
  listUsers,
  getActiveTrip,
} from "@/lib/queries";
import { addMonths, monthKey } from "@/lib/format";
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
  const [
    users,
    categories,
    transactions,
    prevTransactions,
    allTransactions,
    fixedCostMasters,
    paymentMethods,
    cashSnapshots,
    kindColors,
    activeTrip,
  ] = await Promise.all([
    listUsers(hid),
    listCategories(hid),
    listTransactionsForMonth(hid, ym),
    listTransactionsForMonth(hid, prevYm),
    listAllTransactions(hid),
    listFixedCostMasters(hid),
    listPaymentMethods(hid).catch(() => []),
    listCashBalanceSnapshots(hid).catch(() => []),
    listKindColors(hid).catch(() => []),
    getActiveTrip(hid).catch(() => null),
    ensureFixedCostsApplied(hid).catch(() => null),
  ]);

  return (
    <HomeClient
      users={users}
      categories={categories}
      transactions={transactions}
      prevTransactions={prevTransactions}
      allTransactions={allTransactions}
      fixedCostMasters={fixedCostMasters}
      paymentMethods={paymentMethods}
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
