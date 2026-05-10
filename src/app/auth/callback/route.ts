import { NextRequest, NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { getSupabaseServer, getSupabaseAdmin } from "@/lib/supabase/server";
import { acceptInvite } from "@/lib/invite";

/**
 * Magic-link / OAuth callback handler.
 *
 * Supabase magic links can land here with one of three query patterns:
 *  1. PKCE flow         → `?code=<jwt>`
 *  2. Token-hash flow    → `?token_hash=<hash>&type=<email|magiclink|invite|...>`
 *  3. No exchange needed → user already has a session cookie (e.g. they just
 *     finished `supabase.auth.signUp` on the client and we redirected here
 *     to apply post-signup side-effects like household bootstrap or invite
 *     acceptance). In this case we trust the existing session.
 *
 * After establishing a session, we:
 *   - Bootstrap a new household if `?household_name=` is present (signup flow)
 *     and the user isn't a member of any household yet.
 *   - Accept an invitation if `?invite=<token>` is present.
 *   - Redirect to `?next=` (default "/").
 *
 * If we can't find any session at all, we redirect to /login with an error
 * so the user sees what went wrong instead of a blank screen.
 */
/**
 * Limit `?next=` to a relative path on this origin so a crafted
 * `?next=https://evil.example` cannot turn the callback into an
 * open redirect after a successful login.
 */
function safeNext(raw: string | null): string {
  if (!raw) return "/";
  // Reject anything that isn't an in-app absolute path. Includes:
  //   - protocol-relative ("//evil") which the URL constructor treats as a host
  //   - explicit schemes ("https:", "javascript:", ...)
  //   - paths missing the leading slash
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const otpType = url.searchParams.get("type") as EmailOtpType | null;
  const next = safeNext(url.searchParams.get("next"));
  const householdName = url.searchParams.get("household_name");
  const displayName = url.searchParams.get("display_name");
  const inviteToken = url.searchParams.get("invite");

  const sb = getSupabaseServer();

  // ---- 1. Establish session ----------------------------------------------
  // Three sources, in priority order:
  //   (a) An existing cookie session — most relevant when the InviteSignup
  //       form just called supabase.auth.signUp on the client and bounced
  //       us here to apply side-effects.
  //   (b) PKCE code exchange (Magic Link / OAuth).
  //   (c) Token-hash + type (legacy magic-link flow).
  let user: { id: string; email: string | null } | null = null;
  let exchangeError: string | null = null;

  const { data: existingSession } = await sb.auth.getUser();
  if (existingSession?.user) {
    user = { id: existingSession.user.id, email: existingSession.user.email ?? null };
  } else if (code) {
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
    exchangeError = "missing_session";
  }

  if (!user) {
    const errParam = encodeURIComponent(exchangeError ?? "auth_failed");
    // Preserve invite context so the login page can route the user back
    // through the invite landing after they sign in.
    const params = new URLSearchParams({ error: errParam });
    if (inviteToken) params.set("next", `/invite/${inviteToken}`);
    return NextResponse.redirect(new URL(`/login?${params.toString()}`, req.url));
  }

  // ---- 2. Side-effects under admin (bypass RLS for bootstrap) -----------
  const admin = getSupabaseAdmin();

  if (inviteToken) {
    await acceptInvite({
      token: inviteToken,
      userId: user.id,
      userEmail: user.email,
      displayName,
    });
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
      }
    }
  }

  return NextResponse.redirect(new URL(next, req.url));
}
