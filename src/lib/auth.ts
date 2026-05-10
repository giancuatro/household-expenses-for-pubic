/**
 * Supabase-Auth-backed session helpers for Server Components / Server Actions.
 *
 * The shared-password flow that this app shipped with originally has been
 * replaced by Supabase Auth (email magic link + OAuth, configurable in the
 * Supabase dashboard). Pages that need an authenticated user call
 *   const { user, household } = await requireSession();
 * which redirects to /login if the request is anonymous.
 */
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getSupabaseServer, getSupabaseAdmin } from "./supabase/server";

/** Cookie that stores the user's "active" household when they belong to multiple. */
export const HOUSEHOLD_COOKIE = "hx_household";

export interface HouseholdMembership {
  household_id: string;
  role: "owner" | "editor" | "viewer";
  display_name: string | null;
  household: {
    id: string;
    name: string;
    currency: string;
    locale: string;
    onboarding_completed_at: string | null;
  };
}

export interface SessionContext {
  user: { id: string; email: string | null };
  household: HouseholdMembership;
  /** All households the user belongs to (for the household switcher). */
  memberships: HouseholdMembership[];
}

/**
 * Return the current Supabase Auth user (or null if not signed in).
 * Cached per-request so repeated calls don't re-query.
 */
export const getAuthUser = cache(async () => {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return null;
  }
  const sb = getSupabaseServer();
  const { data, error } = await sb.auth.getUser();
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? null };
});

/**
 * Resolve the user's full session context, including which household is
 * "active" for this request. Returns null if not signed in, or if signed in
 * but with no household membership yet (sign-up not finished).
 */
export const getSession = cache(async (): Promise<SessionContext | null> => {
  const user = await getAuthUser();
  if (!user) return null;
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return null;

  // Use service role to read household_members so we never accidentally
  // depend on policies that haven't been deployed yet.
  const admin = getSupabaseAdmin();
  const { data: rows, error } = await admin
    .from("household_members")
    .select(
      "household_id, role, display_name, household:households(id, name, currency, locale, onboarding_completed_at)",
    )
    .eq("auth_user_id", user.id);
  if (error) throw new Error(error.message);

  const memberships = ((rows ?? []) as unknown as HouseholdMembership[]).filter(
    (m): m is HouseholdMembership => !!m.household,
  );
  if (memberships.length === 0) return null;

  const cookieHid = cookies().get(HOUSEHOLD_COOKIE)?.value;
  const active =
    memberships.find((m) => m.household_id === cookieHid) ?? memberships[0];

  return { user, household: active, memberships };
});

/**
 * Used by Server Components / Actions. Three outcomes:
 *  - Not signed in → redirect to /login
 *  - Signed in but no household yet (email-only user, or a half-finished
 *    previous signup) → redirect to /signup so they can claim/create a
 *    household. /signup detects authed state and skips email/password.
 *  - Signed in with at least one household → return the session.
 */
export async function requireSession(): Promise<SessionContext> {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  const s = await getSession();
  if (!s) redirect("/signup");
  return s;
}

/** Convenience: returns just the active household_id (must be signed in). */
export async function requireHouseholdId(): Promise<string> {
  const { household } = await requireSession();
  return household.household_id;
}
