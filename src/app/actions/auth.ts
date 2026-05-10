"use server";

import { z } from "zod";
import { getSupabaseServer, getSupabaseAdmin } from "@/lib/supabase/server";

/**
 * Bootstrap a household for the *currently authenticated* user. Called from
 * the email+password signup flow after `supabase.auth.signUp(...)` succeeds
 * (the cookie session is already set by then). Idempotent — if the user is
 * already a member of any household, this no-ops.
 *
 * Returns the household_id so the caller can redirect or push.
 */
const Schema = z.object({
  householdName: z.string().min(1).max(60),
  displayName: z.string().max(40).optional(),
});

export async function bootstrapHousehold(input: z.infer<typeof Schema>) {
  const { householdName, displayName } = Schema.parse(input);

  const sb = getSupabaseServer();
  const { data: userData, error: userErr } = await sb.auth.getUser();
  if (userErr || !userData?.user) {
    throw new Error("認証セッションが見つかりません。再度ログインしてください。");
  }
  const userId = userData.user.id;
  const userEmail = userData.user.email;

  const admin = getSupabaseAdmin();

  // No-op if the user already belongs to a household
  const { data: existing } = await admin
    .from("household_members")
    .select("household_id")
    .eq("auth_user_id", userId)
    .limit(1);
  if ((existing ?? []).length > 0) {
    return { household_id: (existing as { household_id: string }[])[0].household_id };
  }

  // Create household
  const { data: hh, error: hhErr } = await admin
    .from("households")
    .insert({ name: householdName })
    .select("id")
    .single();
  if (hhErr || !hh) throw new Error(hhErr?.message ?? "世帯の作成に失敗しました。");

  // Add user as owner — surface errors so a half-constructed household
  // doesn't leave the user in a redirect loop (member missing → getSession
  // returns null → /login → middleware redirects authed user to / → loop).
  const { error: memberErr } = await admin.from("household_members").insert({
    household_id: hh.id,
    auth_user_id: userId,
    role: "owner",
    display_name: displayName ?? null,
  });
  if (memberErr) throw new Error(`メンバー登録に失敗: ${memberErr.message}`);

  // Seed default categories
  const seed = [
    ["食費", "shared", 40000, 10],
    ["外食費", "shared", 25000, 20],
    ["移動", "shared", 20000, 30],
    ["日用品", "shared", 10000, 40],
    ["交際費", "shared", 20000, 50],
    ["遊び", "shared", 50000, 60],
    ["その他", "shared", 5000, 70],
    ["水道光熱費", "shared", 15000, 80],
    ["個人支出", "personal", 0, 100],
  ] as const;
  await admin.from("expense_categories").insert(
    seed.map(([name, type, budget_amount, sort_order]) => ({
      household_id: hh.id,
      name,
      type,
      budget_amount,
      sort_order,
    })),
  );

  // Seed payer label matching the auth user
  await admin.from("users").insert({
    household_id: hh.id,
    name: displayName || (userEmail ? userEmail.split("@")[0] : "メンバー"),
    auth_user_id: userId,
  });

  // Seed default kind colors so the home transaction list and charts have
  // consistent colors immediately after signup (the user can re-color any
  // entry from settings → 外観).
  const kindSeed = [
    ["income", "#10b981"],
    ["fixed", "#6366f1"],
    ["loan", "#a855f7"],
    ["special", "#ef4444"],
    ["advance", "#f59e0b"],
    ["investment", "#0ea5e9"],
    ["transfer_in", "#22c55e"],
    ["transfer_out", "#dc2626"],
  ] as const;
  await admin.from("kind_colors").insert(
    kindSeed.map(([kind, color_hex]) => ({
      household_id: hh.id,
      kind,
      color_hex,
    })),
  );

  return { household_id: hh.id };
}

/**
 * Mark the current household's onboarding as completed. Called by the
 * onboarding tour when the user finishes the last slide or taps "skip".
 */
export async function completeOnboarding() {
  const sb = getSupabaseServer();
  const { data: userData } = await sb.auth.getUser();
  if (!userData?.user) throw new Error("認証セッションが見つかりません。");
  const admin = getSupabaseAdmin();
  const { data: members } = await admin
    .from("household_members")
    .select("household_id")
    .eq("auth_user_id", userData.user.id)
    .limit(1);
  const hid = (members as { household_id: string }[] | null)?.[0]?.household_id;
  if (!hid) return;
  await admin
    .from("households")
    .update({ onboarding_completed_at: new Date().toISOString() })
    .eq("id", hid);
}
