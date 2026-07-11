import type { getSupabaseServer } from "@/lib/supabase/server";
import { normalizeMerchant } from "@/lib/csvImport/normalize";
import type { TxnKind } from "@/lib/types";

type Sb = ReturnType<typeof getSupabaseServer>;

export interface AliasValue {
  user_id: string | null;
  category_type: TxnKind | null;
  category_id: string | null;
  label: string | null;
}

/**
 * Learn "this merchant → (user, category)" from a reconciliation the user just
 * confirmed. Keyed by the normalized merchant string. Re-affirming an existing
 * alias bumps hit_count and refreshes the mapping to the latest choice. A blank
 * merchant (nothing to key on) is a no-op. Best-effort: learning failures never
 * block the transaction that triggered them.
 */
export async function learnMerchantAlias(
  sb: Sb,
  hid: string,
  merchantRaw: string | null | undefined,
  value: { user_id: string | null; category_type: TxnKind | null; category_id?: string | null; label?: string | null },
): Promise<void> {
  const norm = normalizeMerchant(merchantRaw);
  if (!norm) return;
  try {
    const { data: existing } = await sb
      .from("merchant_aliases")
      .select("hit_count")
      .eq("household_id", hid)
      .eq("merchant_norm", norm)
      .maybeSingle();
    await sb.from("merchant_aliases").upsert(
      {
        household_id: hid,
        merchant_norm: norm,
        user_id: value.user_id,
        category_type: value.category_type,
        category_id: value.category_id ?? null,
        alias_label: value.label ?? merchantRaw ?? null,
        hit_count: ((existing?.hit_count as number | undefined) ?? 0) + 1,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "household_id,merchant_norm" },
    );
  } catch {
    /* learning is best-effort; never surface to the caller */
  }
}

export interface AliasRow {
  merchant_norm: string;
  user_id: string | null;
  category_type: string | null;
  category_id: string | null;
  alias_label: string | null;
  hit_count: number;
}

// Minimum length before we allow a substring/containment fuzzy match. Short
// tokens ("イオン", "ampm") collide across unrelated merchants, so we only
// fuzzy-match strings this long.
const FUZZY_MIN_LEN = 6;

/**
 * Best fuzzy alias for a normalized merchant, or null. A card issuer prints the
 * same shop slightly differently across statements ("amazon co jp" vs
 * "amazon co jp ac-123"), so an exact-key miss falls through to containment:
 * one normalized string wholly inside the other. Ties break on hit_count — the
 * merchant the household has categorized most often wins.
 */
export function fuzzyFindAlias(norm: string, aliases: AliasRow[]): AliasRow | null {
  if (norm.length < FUZZY_MIN_LEN) return null;
  let best: AliasRow | null = null;
  for (const a of aliases) {
    const an = a.merchant_norm;
    if (an.length < FUZZY_MIN_LEN) continue;
    if (norm.includes(an) || an.includes(norm)) {
      if (!best || a.hit_count > best.hit_count) best = a;
    }
  }
  return best;
}

/**
 * Look up learned aliases for a set of raw merchant strings. Returns a map
 * keyed by the ORIGINAL raw string (so callers can index by the staging row's
 * merchant) → alias value. Merchants with no learned mapping are omitted.
 *
 * Exact normalized-key match wins; misses fall back to a containment fuzzy
 * match so month-to-month merchant-string drift still resolves.
 */
export async function getAliasMap(
  sb: Sb,
  hid: string,
  merchants: (string | null | undefined)[],
): Promise<Map<string, AliasValue>> {
  const rawByNorm = new Map<string, string>();
  for (const m of merchants) {
    const norm = normalizeMerchant(m);
    if (norm && m && !rawByNorm.has(norm)) rawByNorm.set(norm, m);
  }
  if (rawByNorm.size === 0) return new Map();

  // Load the household's whole alias set once: we need it for both the exact
  // lookup and the fuzzy fallback, and a household's alias count is small.
  const { data } = await sb
    .from("merchant_aliases")
    .select("merchant_norm, user_id, category_type, category_id, alias_label, hit_count")
    .eq("household_id", hid);
  const aliases = (data ?? []) as AliasRow[];
  const byNorm = new Map(aliases.map((a) => [a.merchant_norm, a]));

  const out = new Map<string, AliasValue>();
  for (const [norm, raw] of rawByNorm) {
    const hit = byNorm.get(norm) ?? fuzzyFindAlias(norm, aliases);
    if (!hit) continue;
    out.set(raw, {
      user_id: hit.user_id,
      category_type: (hit.category_type as TxnKind | null) ?? null,
      category_id: hit.category_id,
      label: hit.alias_label,
    });
  }
  return out;
}

/**
 * One-time seeding: turn the household's already-categorized card-import
 * history into merchant aliases so the very next import can auto-fill instead
 * of starting cold. We key on the transaction's note — for card-import rows
 * that's the merchant string (or, once learning kicked in, its readable label).
 * The most-frequent (user, category) per normalized merchant wins, and
 * hit_count is seeded from the observed count. Existing aliases are only
 * overwritten when the backfill has at least as many observations.
 */
export async function backfillMerchantAliases(sb: Sb, hid: string): Promise<{ seeded: number }> {
  const { data } = await sb
    .from("transactions")
    .select("note, user_id, category_type, category_id, source, source_ref")
    .eq("household_id", hid)
    .or("source.eq.card-import,source_ref.like.card:%")
    .not("note", "is", null);
  const rows = (data ?? []) as Array<{
    note: string | null;
    user_id: string;
    category_type: string;
    category_id: string | null;
    source: string | null;
    source_ref: string | null;
  }>;

  // norm → (comboKey → {count, value})
  const tally = new Map<string, Map<string, { count: number; value: { user_id: string; category_type: string; category_id: string | null; label: string } }>>();
  for (const r of rows) {
    const norm = normalizeMerchant(r.note);
    if (!norm) continue;
    const combo = `${r.user_id}|${r.category_type}|${r.category_id ?? ""}`;
    const byCombo = tally.get(norm) ?? new Map();
    const cur = byCombo.get(combo) ?? {
      count: 0,
      value: { user_id: r.user_id, category_type: r.category_type, category_id: r.category_id, label: r.note as string },
    };
    cur.count += 1;
    byCombo.set(combo, cur);
    tally.set(norm, byCombo);
  }

  const { data: existingRaw } = await sb
    .from("merchant_aliases")
    .select("merchant_norm, hit_count")
    .eq("household_id", hid);
  const existing = new Map(
    ((existingRaw ?? []) as Array<{ merchant_norm: string; hit_count: number }>).map((e) => [e.merchant_norm, e.hit_count]),
  );

  const upserts: Array<Record<string, unknown>> = [];
  for (const [norm, byCombo] of tally) {
    let win: { count: number; value: { user_id: string; category_type: string; category_id: string | null; label: string } } | null = null;
    for (const v of byCombo.values()) if (!win || v.count > win.count) win = v;
    if (!win) continue;
    // Don't clobber a stronger existing alias.
    if ((existing.get(norm) ?? 0) > win.count) continue;
    upserts.push({
      household_id: hid,
      merchant_norm: norm,
      user_id: win.value.user_id,
      category_type: win.value.category_type,
      category_id: win.value.category_id,
      alias_label: win.value.label,
      hit_count: win.count,
      updated_at: new Date().toISOString(),
    });
  }
  if (upserts.length === 0) return { seeded: 0 };
  for (let i = 0; i < upserts.length; i += 500) {
    await sb.from("merchant_aliases").upsert(upserts.slice(i, i + 500), { onConflict: "household_id,merchant_norm" });
  }
  return { seeded: upserts.length };
}
