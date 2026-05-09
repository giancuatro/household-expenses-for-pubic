import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer, getSupabaseAdmin } from "@/lib/supabase/server";

/**
 * Magic-link / OAuth callback handler.
 *
 * Supabase redirects here with `?code=...` after the user clicks the email
 * link or completes OAuth. We:
 *   1. Exchange the code for a session (sets the auth cookies).
 *   2. If query param `household_name` is present (signup flow) AND the user
 *      isn't already a member of any household, create the household and
 *      add them as the owner.
 *   3. If query param `invite` is present, accept the invitation.
 *   4. Redirect to `?next=` (default "/").
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") || "/";
  const householdName = url.searchParams.get("household_name");
  const displayName = url.searchParams.get("display_name");
  const inviteToken = url.searchParams.get("invite");

  if (!code) {
    return NextResponse.redirect(new URL("/login?error=missing_code", req.url));
  }

  const sb = getSupabaseServer();
  const { data, error } = await sb.auth.exchangeCodeForSession(code);
  if (error || !data?.user) {
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(error?.message ?? "exchange_failed")}`, req.url),
    );
  }

  const userId = data.user.id;
  const userEmail = data.user.email;

  // Use admin client to upsert household_members (RLS would also allow this,
  // but admin avoids race conditions during first-ever signup).
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
      (!userEmail || (invite.email as string).toLowerCase() === userEmail.toLowerCase())
    ) {
      await admin.from("household_members").upsert(
        {
          household_id: invite.household_id,
          auth_user_id: userId,
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
      .eq("auth_user_id", userId)
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
          auth_user_id: userId,
          role: "owner",
          display_name: displayName ?? null,
        });
        // Seed default categories for a brand-new household.
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
        // Seed payer row matching the auth user so transactions can attribute.
        await admin.from("users").insert({
          household_id: hh.id,
          name: displayName || (userEmail ? userEmail.split("@")[0] : "メンバー"),
          auth_user_id: userId,
        });
      }
    }
  }

  return NextResponse.redirect(new URL(next, req.url));
}
