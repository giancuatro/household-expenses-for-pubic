import { getSupabaseAdmin } from "./supabase/server";
import { firstOfMonth, monthKey, monthDateRange, addMonths } from "./format";
import type { FixedCostMasterRow } from "./types";

/**
 * Apply fixed-cost masters for a given month into `transactions`. Scoped per
 * household — every read and write filters by household_id.
 *
 * - For each distinct (name, user_id) pair within the household, pick the
 *   master row with the latest valid_from <= first-of-month.
 * - Insert as transactions with category_type = 'loan' if label is 'ローン',
 *   otherwise 'fixed'.
 * - Dedupe via source_ref = `fixed:<master-id>:<YYYY-MM>` so repeated calls
 *   are idempotent.
 */
export async function applyFixedCostsForMonth(hid: string, ym: string = monthKey()) {
  const sb = getSupabaseAdmin();
  const monthStart = firstOfMonth(ym);
  const { start: cycleStart } = monthDateRange(ym);

  const { count: existingCount } = await sb
    .from("transactions")
    .select("id", { count: "exact", head: true })
    .eq("household_id", hid)
    .eq("source", "fixed-auto")
    .like("source_ref", `fixed:%:${ym}`);
  if (existingCount && existingCount > 0) return { inserted: 0 };

  const { data: masters, error } = await sb
    .from("fixed_cost_masters")
    .select("*")
    .eq("household_id", hid)
    .eq("archived", false)
    .lte("valid_from", monthStart)
    .order("valid_from", { ascending: false });

  if (error) throw new Error(`fixed-cost load: ${error.message}`);
  if (!masters || masters.length === 0) return { inserted: 0 };

  const latest = new Map<string, FixedCostMasterRow>();
  for (const m of masters as FixedCostMasterRow[]) {
    const key = `${m.name}::${m.user_id ?? "shared"}`;
    if (!latest.has(key)) latest.set(key, m);
  }

  const { data: anyUser } = await sb
    .from("users")
    .select("id")
    .eq("household_id", hid)
    .limit(1)
    .maybeSingle();
  const fallbackUserId = anyUser?.id as string | undefined;
  if (!fallbackUserId) return { inserted: 0 };

  const candidateRefs = Array.from(latest.values()).map((m) => `fixed:${m.id}:${ym}`);
  const { data: dismissedRows } = await sb
    .from("fixed_cost_dismissals")
    .select("source_ref")
    .eq("household_id", hid)
    .in("source_ref", candidateRefs);
  const dismissed = new Set(((dismissedRows ?? []) as { source_ref: string }[]).map((r) => r.source_ref));

  const rows = Array.from(latest.values())
    .filter((m) => !dismissed.has(`fixed:${m.id}:${ym}`))
    .map((m) => ({
      household_id: hid,
      date: txDateForCycle(ym, m.payment_day, cycleStart),
      user_id: m.user_id ?? fallbackUserId,
      amount: m.amount,
      category_type: m.label === "ローン" ? "loan" : "fixed",
      category_id: null,
      subcategory: m.name,
      note: m.label,
      source: "fixed-auto",
      source_ref: `fixed:${m.id}:${ym}`,
      payment_method_id: m.payment_method_id ?? null,
    }));

  if (rows.length === 0) return { inserted: 0 };

  const { error: insErr, count } = await sb
    .from("transactions")
    .upsert(rows, { onConflict: "household_id,source_ref", ignoreDuplicates: true, count: "exact" });

  if (insErr) throw new Error(`fixed-cost insert: ${insErr.message}`);
  return { inserted: count ?? 0 };
}

function txDateForCycle(ym: string, paymentDay: number | null, cycleStart: string): string {
  if (paymentDay == null) return cycleStart;
  const [y, m] = ym.split("-").map(Number);
  let calY = y;
  let calM = paymentDay < 20 ? m : m - 1;
  if (calM < 1) {
    calM += 12;
    calY -= 1;
  }
  const lastDay = new Date(calY, calM, 0).getDate();
  const day = Math.min(paymentDay, lastDay);
  return `${calY}-${String(calM).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export async function regenerateFixedCostForMaster(hid: string, masterId: string, forward = 2) {
  const sb = getSupabaseAdmin();

  const { data: master, error: mErr } = await sb
    .from("fixed_cost_masters")
    .select("*")
    .eq("household_id", hid)
    .eq("id", masterId)
    .maybeSingle();
  if (mErr) throw new Error(`fixed-cost reload: ${mErr.message}`);
  if (!master) return;
  const m = master as FixedCostMasterRow;

  const cycles: string[] = [];
  const current = monthKey();
  for (let i = 0; i <= forward; i++) cycles.push(addMonths(current, i));

  const sourceRefs = cycles.map((ym) => `fixed:${masterId}:${ym}`);

  const { error: delErr } = await sb
    .from("transactions")
    .delete()
    .eq("household_id", hid)
    .eq("source", "fixed-auto")
    .in("source_ref", sourceRefs);
  if (delErr) throw new Error(`fixed-cost regen delete: ${delErr.message}`);

  // The after-delete trigger writes dismissals for the rows we just removed.
  // Clear them now — `regenerateFixedCostForMaster` is the explicit "rewrite"
  // path, so the user's intent is to re-create these rows, not suppress them.
  await sb
    .from("fixed_cost_dismissals")
    .delete()
    .eq("household_id", hid)
    .in("source_ref", sourceRefs);

  if (m.archived) return;

  const { data: anyUser } = await sb
    .from("users")
    .select("id")
    .eq("household_id", hid)
    .limit(1)
    .maybeSingle();
  const fallbackUserId = anyUser?.id as string | undefined;
  if (!fallbackUserId) return;

  const rows = cycles
    .filter((ym) => m.valid_from <= firstOfMonth(ym))
    .map((ym) => {
      const { start: cycleStart } = monthDateRange(ym);
      return {
        household_id: hid,
        date: txDateForCycle(ym, m.payment_day, cycleStart),
        user_id: m.user_id ?? fallbackUserId,
        amount: m.amount,
        category_type: m.label === "ローン" ? "loan" : "fixed",
        category_id: null,
        subcategory: m.name,
        note: m.label,
        source: "fixed-auto",
        source_ref: `fixed:${m.id}:${ym}`,
        payment_method_id: m.payment_method_id ?? null,
      };
    });

  if (rows.length === 0) return;
  const { error: insErr } = await sb
    .from("transactions")
    .upsert(rows, { onConflict: "household_id,source_ref", ignoreDuplicates: false });
  if (insErr) throw new Error(`fixed-cost regen insert: ${insErr.message}`);
}

export async function applyFixedCostsCatchUp(hid: string, lookback = 3) {
  const results: { ym: string; inserted: number }[] = [];
  const current = monthKey();
  for (let i = 0; i <= lookback; i++) {
    const ym = addMonths(current, -i);
    try {
      const r = await applyFixedCostsForMonth(hid, ym);
      results.push({ ym, inserted: r.inserted });
    } catch {
      /* swallow */
    }
  }
  return results;
}
