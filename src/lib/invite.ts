import { getSupabaseAdmin } from "./supabase/server";

/**
 * Accept a household invitation for a known authenticated user. Idempotent:
 * if the invite is missing, expired, already accepted, or doesn't match the
 * caller's email (when the invite was email-targeted), this returns a status
 * but does not throw. Caller decides what to surface.
 *
 * Side effects on success:
 *   1. Upsert household_members (sets the role/display_name on the invite).
 *   2. Stamp household_invitations.accepted_at = now() so the link is single-use.
 *   3. Insert a `users` (payer label) row if the new member doesn't already
 *      have one in this household, so they appear in the payer dropdown.
 */
export type AcceptInviteResult =
  | { ok: true; household_id: string }
  | { ok: false; reason: "not_found" | "already_accepted" | "expired" | "email_mismatch" };

export async function acceptInvite({
  token,
  userId,
  userEmail,
  displayName,
}: {
  token: string;
  userId: string;
  userEmail: string | null;
  displayName?: string | null;
}): Promise<AcceptInviteResult> {
  const admin = getSupabaseAdmin();

  const { data: invite } = await admin
    .from("household_invitations")
    .select("id, household_id, role, email, expires_at, accepted_at")
    .eq("token", token)
    .maybeSingle();

  if (!invite) return { ok: false, reason: "not_found" };
  if (invite.accepted_at) return { ok: false, reason: "already_accepted" };
  if (new Date(invite.expires_at as string) < new Date()) {
    return { ok: false, reason: "expired" };
  }

  // Email-targeted invites (invite.email != "") require the signed-in email
  // to match. Open invites (email = "") accept any signed-in user.
  const inviteEmail = ((invite.email as string | null) ?? "").trim().toLowerCase();
  if (inviteEmail !== "" && userEmail && inviteEmail !== userEmail.toLowerCase()) {
    return { ok: false, reason: "email_mismatch" };
  }

  const householdId = invite.household_id as string;

  await admin.from("household_members").upsert(
    {
      household_id: householdId,
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

  const { data: existingPayer } = await admin
    .from("users")
    .select("id")
    .eq("household_id", householdId)
    .eq("auth_user_id", userId)
    .limit(1);

  if ((existingPayer ?? []).length === 0) {
    const fallback = displayName
      || (userEmail ? userEmail.split("@")[0] : null)
      || "メンバー";
    await admin.from("users").insert({
      household_id: householdId,
      name: fallback,
      auth_user_id: userId,
    });
  }

  return { ok: true, household_id: householdId };
}
