#!/usr/bin/env tsx
/**
 * Migrate data from a legacy single-tenant Supabase project into a household
 * in this multi-tenant deployment.
 *
 * USAGE
 * -----
 *   1. Sign up on the new instance (web UI: /signup) to create your auth user
 *      and the destination household.
 *   2. Look up your destination household_id:
 *        select id, name from households order by created_at;
 *      Copy the row that matches the household you just created.
 *   3. Create a `.env.migrate` file in the repo root with:
 *
 *        # Source — the old single-tenant Supabase project
 *        LEGACY_SUPABASE_URL=https://<old-project>.supabase.co
 *        LEGACY_SUPABASE_SERVICE_ROLE_KEY=eyJ...
 *
 *        # Destination — the new multi-tenant Supabase project
 *        TARGET_SUPABASE_URL=https://<new-project>.supabase.co
 *        TARGET_SUPABASE_SERVICE_ROLE_KEY=eyJ...
 *
 *        # The household_id from step 2
 *        TARGET_HOUSEHOLD_ID=00000000-0000-0000-0000-000000000000
 *
 *        # Optional: dry run (no writes, just print counts)
 *        DRY_RUN=false
 *
 *   4. Run:
 *        npm run migrate:legacy
 *
 * WHAT IT DOES
 * ------------
 *   - Reads every row of every domain table from the legacy project.
 *   - Re-inserts into the new project under TARGET_HOUSEHOLD_ID.
 *   - Re-maps legacy `users.id` → new `users.id` (keyed by name) so foreign
 *     keys in transactions / fixed_cost_masters / payment_methods stay valid.
 *   - Re-maps legacy `payment_methods.id` and `expense_categories.id` and
 *     `investment_accounts.id` similarly so foreign-key consistency holds.
 *   - Skips investment_holdings (these are recomputed from trades).
 *   - The script is *idempotent on row content but not on PK*: re-running
 *     will create duplicates. Truncate the target tables first if you need
 *     to re-run.
 *
 *   Order matters because of foreign-key dependencies:
 *     users → expense_categories → payment_methods → fixed_cost_masters
 *           → transactions → investment_accounts → investment_transactions
 *           → cash_balance_snapshots
 *
 * SAFETY
 * ------
 *   - Read-only against the legacy project (no DELETE / UPDATE).
 *   - Writes only into rows tagged with TARGET_HOUSEHOLD_ID; existing data in
 *     other households is untouched.
 *   - Never touches auth.users in either project.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.migrate" });

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

const LEGACY_URL = need("LEGACY_SUPABASE_URL");
const LEGACY_KEY = need("LEGACY_SUPABASE_SERVICE_ROLE_KEY");
const TARGET_URL = need("TARGET_SUPABASE_URL");
const TARGET_KEY = need("TARGET_SUPABASE_SERVICE_ROLE_KEY");
const TARGET_HOUSEHOLD_ID = need("TARGET_HOUSEHOLD_ID");
const DRY_RUN = process.env.DRY_RUN === "true";

const legacy = createClient(LEGACY_URL, LEGACY_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const target = createClient(TARGET_URL, TARGET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type Row = Record<string, unknown>;

async function fetchAll(client: SupabaseClient, table: string): Promise<Row[]> {
  const PAGE = 1000;
  const all: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client.from(table).select("*").range(from, from + PAGE - 1);
    if (error) throw new Error(`fetchAll(${table}): ${error.message}`);
    const rows = (data ?? []) as Row[];
    all.push(...rows);
    if (rows.length < PAGE) break;
  }
  return all;
}

async function insertIfNeeded(table: string, rows: Row[]): Promise<Row[]> {
  if (rows.length === 0) return [];
  if (DRY_RUN) {
    console.log(`  [dry] would insert ${rows.length} rows into ${table}`);
    return rows.map((r) => ({ ...r, id: r.id })); // pretend ids stay
  }
  // Insert in chunks of 500 to stay under Supabase row limits.
  const inserted: Row[] = [];
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { data, error } = await target.from(table).insert(chunk).select();
    if (error) throw new Error(`insert ${table} [${i}..${i + chunk.length}]: ${error.message}`);
    inserted.push(...((data ?? []) as Row[]));
  }
  return inserted;
}

/**
 * Strip system / household-scoped fields from a legacy row before we hand it
 * to the new project. We always assign a fresh PK, fresh timestamps stay
 * defaulted, and household_id is stamped from the destination env.
 */
function clean<T extends Row>(row: T, drop: (keyof T | string)[]): Omit<T, "id"> {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    if (drop.includes(k as keyof T)) continue;
    out[k] = v;
  }
  return out as Omit<T, "id">;
}

async function migrate(): Promise<void> {
  console.log(`Migration mode: ${DRY_RUN ? "DRY RUN (no writes)" : "LIVE"}`);
  console.log(`Target household: ${TARGET_HOUSEHOLD_ID}\n`);

  // 0. Sanity: target household exists
  const { data: hh, error: hhErr } = await target
    .from("households")
    .select("id, name")
    .eq("id", TARGET_HOUSEHOLD_ID)
    .maybeSingle();
  if (hhErr) throw new Error(hhErr.message);
  if (!hh) throw new Error(`Target household ${TARGET_HOUSEHOLD_ID} not found in destination`);
  console.log(`Verified destination household: "${hh.name}"\n`);

  // 1. users (payer labels)
  console.log("► users");
  const legacyUsers = await fetchAll(legacy, "users");
  console.log(`  ${legacyUsers.length} rows`);
  const userPayload = legacyUsers.map((u) => ({
    ...clean(u, ["id", "household_id", "auth_user_id"]),
    household_id: TARGET_HOUSEHOLD_ID,
  }));
  const newUsers = await insertIfNeeded("users", userPayload);
  const userMap = new Map<string, string>();
  legacyUsers.forEach((legacy, i) => {
    const newId = (newUsers[i]?.id ?? legacy.id) as string;
    userMap.set(legacy.id as string, newId);
  });

  // 2. expense_categories
  console.log("► expense_categories");
  const legacyCats = await fetchAll(legacy, "expense_categories");
  console.log(`  ${legacyCats.length} rows`);
  const catPayload = legacyCats.map((c) => ({
    ...clean(c, ["id", "household_id"]),
    household_id: TARGET_HOUSEHOLD_ID,
  }));
  const newCats = await insertIfNeeded("expense_categories", catPayload);
  const catMap = new Map<string, string>();
  legacyCats.forEach((c, i) => catMap.set(c.id as string, (newCats[i]?.id ?? c.id) as string));

  // 3. payment_methods
  console.log("► payment_methods");
  const legacyPMs = await fetchAll(legacy, "payment_methods");
  console.log(`  ${legacyPMs.length} rows`);
  const pmPayload = legacyPMs.map((m) => ({
    ...clean(m, ["id", "household_id"]),
    household_id: TARGET_HOUSEHOLD_ID,
    user_id: m.user_id ? userMap.get(m.user_id as string) ?? null : null,
  }));
  const newPMs = await insertIfNeeded("payment_methods", pmPayload);
  const pmMap = new Map<string, string>();
  legacyPMs.forEach((m, i) => pmMap.set(m.id as string, (newPMs[i]?.id ?? m.id) as string));

  // 4. fixed_cost_masters
  console.log("► fixed_cost_masters");
  const legacyFC = await fetchAll(legacy, "fixed_cost_masters");
  console.log(`  ${legacyFC.length} rows`);
  const fcPayload = legacyFC.map((f) => ({
    ...clean(f, ["id", "household_id"]),
    household_id: TARGET_HOUSEHOLD_ID,
    user_id: f.user_id ? userMap.get(f.user_id as string) ?? null : null,
    payment_method_id: f.payment_method_id ? pmMap.get(f.payment_method_id as string) ?? null : null,
  }));
  await insertIfNeeded("fixed_cost_masters", fcPayload);

  // 5. transactions (largest table — paginate)
  console.log("► transactions");
  const legacyTxn = await fetchAll(legacy, "transactions");
  console.log(`  ${legacyTxn.length} rows`);
  const txnPayload = legacyTxn.map((t) => ({
    ...clean(t, ["id", "household_id"]),
    household_id: TARGET_HOUSEHOLD_ID,
    user_id: userMap.get(t.user_id as string) ?? t.user_id,
    category_id: t.category_id ? catMap.get(t.category_id as string) ?? null : null,
    payment_method_id: t.payment_method_id ? pmMap.get(t.payment_method_id as string) ?? null : null,
  }));
  const newTxns = await insertIfNeeded("transactions", txnPayload);
  const txnMap = new Map<string, string>();
  legacyTxn.forEach((t, i) => txnMap.set(t.id as string, (newTxns[i]?.id ?? t.id) as string));

  // 6. investment_accounts
  console.log("► investment_accounts");
  const legacyAcc = await fetchAll(legacy, "investment_accounts");
  console.log(`  ${legacyAcc.length} rows`);
  const accPayload = legacyAcc.map((a) => ({
    ...clean(a, ["id", "household_id"]),
    household_id: TARGET_HOUSEHOLD_ID,
    user_id: userMap.get(a.user_id as string) ?? a.user_id,
  }));
  const newAccs = await insertIfNeeded("investment_accounts", accPayload);
  const accMap = new Map<string, string>();
  legacyAcc.forEach((a, i) => accMap.set(a.id as string, (newAccs[i]?.id ?? a.id) as string));

  // 7. investment_transactions
  console.log("► investment_transactions");
  const legacyInvTxn = await fetchAll(legacy, "investment_transactions");
  console.log(`  ${legacyInvTxn.length} rows`);
  const invTxnPayload = legacyInvTxn.map((t) => ({
    ...clean(t, ["id", "household_id"]),
    household_id: TARGET_HOUSEHOLD_ID,
    user_id: userMap.get(t.user_id as string) ?? t.user_id,
    account_id: t.account_id ? accMap.get(t.account_id as string) ?? null : null,
    linked_transaction_id: t.linked_transaction_id
      ? txnMap.get(t.linked_transaction_id as string) ?? null
      : null,
  }));
  await insertIfNeeded("investment_transactions", invTxnPayload);

  // 8. cash_balance_snapshots
  console.log("► cash_balance_snapshots");
  const legacyCash = await fetchAll(legacy, "cash_balance_snapshots");
  console.log(`  ${legacyCash.length} rows`);
  const cashPayload = legacyCash.map((c) => ({
    ...clean(c, ["id", "household_id"]),
    household_id: TARGET_HOUSEHOLD_ID,
  }));
  await insertIfNeeded("cash_balance_snapshots", cashPayload);

  // 9. Skip investment_holdings — they get recomputed from trades by the app
  console.log("► investment_holdings — skipped (recomputed from trades by app)");

  console.log("\n✅ Migration complete.");
  console.log("Open the app, go to 投資 tab, and click 「保有を再計算」 (or trigger any");
  console.log("trade-affecting action) to rebuild investment_holdings rows.");
}

migrate().catch((e) => {
  console.error("\n❌ Migration failed:", e);
  process.exit(1);
});
