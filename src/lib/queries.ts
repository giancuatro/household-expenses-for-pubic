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
  KindColorRow,
  TripRow,
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
    revalidate: 60,
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
    revalidate: 60,
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
    revalidate: 60,
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
    revalidate: 60,
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
    revalidate: 60,
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
    revalidate: 60,
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
    revalidate: 60,
  })();
}

async function _listKindColors(hid: string): Promise<KindColorRow[]> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("kind_colors")
    .select("kind, color_hex")
    .eq("household_id", hid);
  if (error) throw new Error(error.message);
  return (data ?? []) as KindColorRow[];
}

export async function listKindColors(hid: string): Promise<KindColorRow[]> {
  return unstable_cache(() => _listKindColors(hid), ["kind-colors", hid], {
    tags: [`hh:${hid}:kind-colors`, `hh:${hid}`],
    revalidate: 60,
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

/* ========== Travel mode (Phase 7) ========== */

async function _listTrips(hid: string): Promise<TripRow[]> {
  const sb = getSupabaseAdmin();
  // Active trip(s) first (ended_at NULL), then most recent.
  const { data, error } = await sb
    .from("trips")
    .select("*")
    .eq("household_id", hid)
    .order("ended_at", { ascending: true, nullsFirst: true })
    .order("started_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as TripRow[];
}

export async function listTrips(hid: string): Promise<TripRow[]> {
  return unstable_cache(() => _listTrips(hid), ["trips", hid], {
    tags: [`hh:${hid}:trips`, `hh:${hid}`],
    revalidate: 60,
  })();
}

/**
 * Active trip = most recent row with `ended_at IS NULL`. The home entry form
 * uses this to decide whether to render the foreign-currency input. Multiple
 * active trips are not expected (the start action enforces single-active),
 * but if one slipped in we pick the latest started_at.
 */
export async function getActiveTrip(hid: string): Promise<TripRow | null> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("trips")
    .select("*")
    .eq("household_id", hid)
    .is("ended_at", null)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as TripRow | null) ?? null;
}

/** Pending-FX transactions across all time (drives the dashboard banner). */
export async function listPendingFxTransactions(hid: string): Promise<TransactionRow[]> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("transactions")
    .select("*")
    .eq("household_id", hid)
    .eq("fx_status", "pending")
    .order("date", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as TransactionRow[];
}
