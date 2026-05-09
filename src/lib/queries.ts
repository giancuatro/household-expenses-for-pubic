import { unstable_cache } from "next/cache";
import { getSupabaseAdmin } from "./supabase/server";
import { monthDateRange } from "./format";
import type {
  CategoryRow,
  TransactionRow,
  UserRow,
  FixedCostMasterRow,
  InvestmentAccountRow,
  PaymentMethodRow,
  CashBalanceSnapshotRow,
} from "./types";

/**
 * Reads run through the service-role client + an explicit household_id WHERE
 * filter. This pattern lets us keep `unstable_cache` (which is request-context-
 * free) without exposing data from other households — the household_id is
 * resolved per-request from the session cookie via `requireHouseholdId()` and
 * passed in by the calling Server Component.
 *
 * Cache keys / tags include the household_id so revalidating one household
 * doesn't bust caches of another.
 */

/* ========== Master tables (low change frequency) ========== */

async function _listUsers(hid: string): Promise<UserRow[]> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("users")
    .select("*")
    .eq("household_id", hid)
    .order("created_at");
  if (error) throw new Error(error.message);
  return (data ?? []) as UserRow[];
}

export async function listUsers(hid: string): Promise<UserRow[]> {
  return unstable_cache(() => _listUsers(hid), ["users", hid], {
    tags: [`hh:${hid}:users`, `hh:${hid}`],
  })();
}

async function _listCategories(hid: string): Promise<CategoryRow[]> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("expense_categories")
    .select("*")
    .eq("household_id", hid)
    .order("sort_order");
  if (error) throw new Error(error.message);
  return (data ?? []) as CategoryRow[];
}

export async function listCategories(hid: string): Promise<CategoryRow[]> {
  return unstable_cache(() => _listCategories(hid), ["categories", hid], {
    tags: [`hh:${hid}:categories`, `hh:${hid}`],
  })();
}

async function _listFixedCostMasters(hid: string): Promise<FixedCostMasterRow[]> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("fixed_cost_masters")
    .select("*")
    .eq("household_id", hid)
    .order("valid_from", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as FixedCostMasterRow[];
}

export async function listFixedCostMasters(hid: string): Promise<FixedCostMasterRow[]> {
  return unstable_cache(() => _listFixedCostMasters(hid), ["fixed-cost-masters", hid], {
    tags: [`hh:${hid}:fixed-cost-masters`, `hh:${hid}`],
  })();
}

async function _listInvestmentAccounts(hid: string): Promise<InvestmentAccountRow[]> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("investment_accounts")
    .select("*")
    .eq("household_id", hid)
    .order("created_at");
  if (error) throw new Error(error.message);
  return (data ?? []) as InvestmentAccountRow[];
}

export async function listInvestmentAccounts(hid: string): Promise<InvestmentAccountRow[]> {
  return unstable_cache(() => _listInvestmentAccounts(hid), ["investment-accounts", hid], {
    tags: [`hh:${hid}:investment-accounts`, `hh:${hid}`],
  })();
}

async function _listPaymentMethods(hid: string): Promise<PaymentMethodRow[]> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("payment_methods")
    .select("*")
    .eq("household_id", hid)
    .eq("archived", false)
    .order("display_order")
    .order("created_at");
  if (error) throw new Error(error.message);
  return (data ?? []) as PaymentMethodRow[];
}

export async function listPaymentMethods(hid: string): Promise<PaymentMethodRow[]> {
  return unstable_cache(() => _listPaymentMethods(hid), ["payment-methods", hid], {
    tags: [`hh:${hid}:payment-methods`, `hh:${hid}`],
  })();
}

async function _listAllPaymentMethods(hid: string): Promise<PaymentMethodRow[]> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("payment_methods")
    .select("*")
    .eq("household_id", hid)
    .order("archived")
    .order("display_order")
    .order("created_at");
  if (error) throw new Error(error.message);
  return (data ?? []) as PaymentMethodRow[];
}

export async function listAllPaymentMethods(hid: string): Promise<PaymentMethodRow[]> {
  return unstable_cache(() => _listAllPaymentMethods(hid), ["payment-methods-all", hid], {
    tags: [`hh:${hid}:payment-methods`, `hh:${hid}`],
  })();
}

async function _listCashBalanceSnapshots(hid: string): Promise<CashBalanceSnapshotRow[]> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("cash_balance_snapshots")
    .select("*")
    .eq("household_id", hid)
    .order("as_of_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as CashBalanceSnapshotRow[];
}

export async function listCashBalanceSnapshots(hid: string): Promise<CashBalanceSnapshotRow[]> {
  return unstable_cache(() => _listCashBalanceSnapshots(hid), ["cash-balance", hid], {
    tags: [`hh:${hid}:cash-balance`, `hh:${hid}`],
  })();
}

/* ========== Transactions (high change frequency, tag-keyed by month) ========== */

async function _listTransactionsForMonth(hid: string, ym: string): Promise<TransactionRow[]> {
  const sb = getSupabaseAdmin();
  const { start, end } = monthDateRange(ym);
  const { data, error } = await sb
    .from("transactions")
    .select("*")
    .eq("household_id", hid)
    .gte("date", start)
    .lte("date", end)
    .order("date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as TransactionRow[];
}

export async function listTransactionsForMonth(hid: string, ym: string): Promise<TransactionRow[]> {
  return unstable_cache(
    () => _listTransactionsForMonth(hid, ym),
    ["transactions-month", hid, ym],
    { tags: [`hh:${hid}:txn:${ym}`, `hh:${hid}:transactions`, `hh:${hid}`], revalidate: 60 },
  )();
}

async function _listAllTransactions(hid: string): Promise<TransactionRow[]> {
  const sb = getSupabaseAdmin();
  const PAGE = 1000;
  const all: TransactionRow[] = [];
  for (let page = 0; ; page++) {
    const from = page * PAGE;
    const { data, error } = await sb
      .from("transactions")
      .select("*")
      .eq("household_id", hid)
      .order("date")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    all.push(...((data ?? []) as TransactionRow[]));
    if ((data ?? []).length < PAGE) break;
  }
  return all;
}

export async function listAllTransactions(hid: string): Promise<TransactionRow[]> {
  return unstable_cache(() => _listAllTransactions(hid), ["transactions-all", hid], {
    tags: [`hh:${hid}:transactions`, `hh:${hid}`],
    revalidate: 60,
  })();
}
