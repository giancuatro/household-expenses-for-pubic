"use server";

import { revalidateTag } from "next/cache";
import { getSupabaseServer } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth";
import { backfillMerchantAliases } from "@/lib/reconcile/merchantAlias";

/**
 * Seed merchant_aliases from the household's already-categorized card-import
 * history, so the next statement import auto-fills instead of starting cold.
 * Idempotent — safe to re-run; only strengthens or refreshes aliases.
 */
export async function rebuildMerchantLearning(): Promise<{ seeded: number }> {
  const { household } = await requireSession();
  const hid = household.household_id;
  const sb = getSupabaseServer();
  const res = await backfillMerchantAliases(sb, hid);
  revalidateTag(`hh:${hid}:reconcile`);
  return res;
}
