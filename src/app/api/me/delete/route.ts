import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DSAR — Data Subject Erasure Request: deletes the caller's auth.users row
 * and, if they are the *sole owner* of a household, cascades through
 * household + all attached data tables.
 *
 *   - Solo owner    → deletes the household and every cascade-linked row
 *   - Co-member     → only removes the caller's household_members row, the
 *                     household and the rest of the data is preserved
 *   - Always        → deletes the auth.users row (Supabase cascades through
 *                     household_members and household_invitations)
 *
 * Confirmation gate: the request body must include `{ confirm: "DELETE" }`
 * to guard against accidental clicks. Returns 200 with a body indicating
 * what was deleted, then signs the user out client-side.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { confirm?: string };
  if (body.confirm !== "DELETE") {
    return NextResponse.json(
      { error: 'confirmation required: send { confirm: "DELETE" }' },
      { status: 400 },
    );
  }

  const { user, household } = await requireSession();
  const admin = getSupabaseAdmin();

  // Is the caller the sole *owner* of this household?
  const { data: members } = await admin
    .from("household_members")
    .select("auth_user_id, role")
    .eq("household_id", household.household_id);
  const memberRows = (members ?? []) as { auth_user_id: string; role: string }[];
  const owners = memberRows.filter((m) => m.role === "owner");
  const isSoleOwner = owners.length === 1 && owners[0].auth_user_id === user.id;

  let deletedHousehold = false;

  if (isSoleOwner) {
    // Household FK cascades will sweep all child rows (transactions,
    // expense_categories, fixed_cost_masters, payment_methods,
    // investment_accounts/holdings/transactions, cash_balance_snapshots,
    // household_members, household_invitations).
    const { error: hhErr } = await admin
      .from("households")
      .delete()
      .eq("id", household.household_id);
    if (hhErr) {
      return NextResponse.json({ error: `household delete failed: ${hhErr.message}` }, { status: 500 });
    }
    deletedHousehold = true;
  } else {
    // Multi-owner or non-owner — just remove the caller's membership row.
    const { error: memErr } = await admin
      .from("household_members")
      .delete()
      .eq("household_id", household.household_id)
      .eq("auth_user_id", user.id);
    if (memErr) {
      return NextResponse.json({ error: `member delete failed: ${memErr.message}` }, { status: 500 });
    }
  }

  // Delete the auth user. This invalidates all of their sessions across
  // every device. Supabase cascades through household_members /
  // household_invitations on user delete via the FK we declared.
  const { error: authErr } = await admin.auth.admin.deleteUser(user.id);
  if (authErr) {
    return NextResponse.json({ error: `auth delete failed: ${authErr.message}` }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    deletedHousehold,
    message: deletedHousehold
      ? "世帯と全データを削除しました。"
      : "あなたのアカウントを削除しました。世帯は他のオーナー / メンバーが利用継続します。",
  });
}
