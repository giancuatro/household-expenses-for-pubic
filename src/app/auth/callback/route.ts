import { NextRequest, NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { getSupabaseServer, getSupabaseAdmin } from "@/lib/supabase/server";

/**
 * Magic-link / OAuth callback handler.
 *
 * Supabase magic links can land here with one of two query patterns,
 * depending on the auth flow Supabase chose:
 *
 *  1. PKCE flow      → `?code=<jwt>`
 *  2. Token-hash flow → `?token_hash=<hash>&type=<email|magiclink|invite|...>`
 *
 * We accept both. After establishing a session, we:
 *   - Bootstrap a new household if `?household_name=` is present (signup flow)
 *     and the user isn't a member of any household yet.
 *   - Accept an invitation if `?invite=<token>` is present.
 *   - Redirect to `?next=` (default "/").
 *
 * If neither `code` nor `token_hash` is present, we redirect to /login with
 * an error so the user sees what went wrong instead of a blank screen.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const otpType = url.searchParams.get("type") as EmailOtpType | null;
  const next = url.searchParams.get("next") || "/";
  const householdName = url.searchParams.get("household_name");
  const displayName = url.searchParams.get("display_name");
  const inviteToken = url.searchParams.get("invite");

  const sb = getSupabaseServer();

  // ---- 1. Establish session (PKCE OR token-hash) -------------------------
  let user: { id: string; email: string | null } | null = null;
  let exchangeError: string | null = null;

  if (code) {
    const { data, error } = await sb.auth.exchangeCodeForSession(code);
    if (error || !data?.user) {
      exchangeError = error?.message ?? "exchange_failed";
    } else {
      user = { id: data.user.id, email: data.user.email ?? null };
    }
  } else if (tokenHash && otpType) {
    const { data, error } = await sb.auth.verifyOtp({ token_hash: tokenHash, type: otpType });
    if (error || !data?.user) {
      exchangeError = error?.message ?? "verify_failed";
    } else {
      user = { id: data.user.id, email: data.user.email ?? null };
    }
  } else {
    exchangeError = "missing_code_or_token_hash";
  }

  if (!user) {
    const errParam = encodeURIComponent(exchangeError ?? "auth_failed");
    return NextResponse.redirect(new URL(`/login?error=${errParam}`, req.url));
  }

  // ---- 2. Side-effects under admin (bypass RLS for bootstrap) -----------
  const admin = getSupabaseAdmin();

  // Accept invitation if token provided
  if (inviteToken) {
    const { data: invite } = await admin
      .from("household_invitations")
      .select("id, household_id, role, email, expires_at, accepted_at")
      .eq("token", inviteToken)
      .maybeSingle();
    if (
      invite &&
      !invite.accepted_at &&
      new Date(invite.expires_at as string) > new Date() &&
      (!user.email || (invite.email as string).toLowerCase() === user.email.toLowerCase())
    ) {
      await admin.from("household_members").upsert(
        {
          household_id: invite.household_id,
          auth_user_id: user.id,
          role: invite.role,
          display_name: displayName ?? null,
        },
        { onConflict: "household_id,auth_user_id" },
      );
      await admin
        .from("household_invitations")
        .update({ accepted_at: new Date().toISOString() })
        .eq("id", invite.id);
    }
  }

  // Bootstrap a new household if the signup form provided a name AND the
  // user has no membership yet.
  if (householdName) {
    const { data: existing } = await admin
      .from("household_members")
      .select("household_id")
      .eq("auth_user_id", user.id)
      .limit(1);
    if ((existing ?? []).length === 0) {
      const { data: hh, error: hhErr } = await admin
        .from("households")
        .insert({ name: householdName })
        .select("id")
        .single();
      if (!hhErr && hh) {
        await admin.from("household_members").insert({
          household_id: hh.id,
          auth_user_id: user.id,
          role: "owner",
          display_name: displayName ?? null,
        });
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
        await admin.from("users").insert({
          household_id: hh.id,
          name: displayName || (user.email ? user.email.split("@")[0] : "メンバー"),
          auth_user_id: user.id,
        });
      }
    }
  }

  return NextResponse.redirect(new URL(next, req.url));
}
