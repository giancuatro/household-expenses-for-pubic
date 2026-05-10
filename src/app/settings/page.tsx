import {
  listCategories,
  listFixedCostMasters,
  listUsers,
  listInvestmentAccounts,
  listAllPaymentMethods,
  listCashBalanceSnapshots,
  listKindColors,
} from "@/lib/queries";
import { requireSession } from "@/lib/auth";
import SettingsClient from "./SettingsClient";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const { household, memberships } = await requireSession();
  const hid = household.household_id;
  const [users, categories, fixed, investmentAccounts, paymentMethods, cashSnapshots, kindColors] =
    await Promise.all([
      listUsers(hid),
      listCategories(hid),
      listFixedCostMasters(hid),
      listInvestmentAccounts(hid),
      listAllPaymentMethods(hid).catch(() => []),
      listCashBalanceSnapshots(hid).catch(() => []),
      listKindColors(hid).catch(() => []),
    ]);
  return (
    <SettingsClient
      users={users}
      categories={categories}
      fixed={fixed}
      investmentAccounts={investmentAccounts}
      paymentMethods={paymentMethods}
      cashSnapshots={cashSnapshots}
      kindColors={kindColors}
      household={household}
      memberships={memberships}
    />
  );
}
