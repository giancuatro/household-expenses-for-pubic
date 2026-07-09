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

/**
 * Look up learned aliases for a set of raw merchant strings. Returns a map
 * keyed by the ORIGINAL raw string (so callers can index by the staging row's
 * merchant) → alias value. Merchants with no learned mapping are omitted.
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
  const { data } = await sb
    .from("merchant_aliases")
    .select("merchant_norm, user_id, category_type, category_id, alias_label")
    .eq("household_id", hid)
    .in("merchant_norm", Array.from(rawByNorm.keys()));
  const out = new Map<string, AliasValue>();
  for (const r of (data ?? []) as Array<{
    merchant_norm: string;
    user_id: string | null;
    category_type: string | null;
    category_id: string | null;
    alias_label: string | null;
  }>) {
    const raw = rawByNorm.get(r.merchant_norm);
    if (!raw) continue;
    out.set(raw, {
      user_id: r.user_id,
      category_type: (r.category_type as TxnKind | null) ?? null,
      category_id: r.category_id,
      label: r.alias_label,
    });
  }
  return out;
}
