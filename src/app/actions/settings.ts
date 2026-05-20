"use server";

import { revalidateTag } from "next/cache";
import { z } from "zod";
import { getSupabaseServer, getSupabaseAdmin } from "@/lib/supabase/server";
import { requireSession, HOUSEHOLD_COOKIE } from "@/lib/auth";
import { cookies } from "next/headers";
import { firstOfMonth } from "@/lib/format";
import { regenerateFixedCostForMaster } from "@/lib/fixedCosts";
import { randomBytes } from "crypto";

/* -------------------- Household-wide entry defaults -------------------- */
const HouseholdDefaultsSchema = z.object({
  default_user_id: z.string().uuid().nullable().optional(),
  default_payment_method_id: z.string().uuid().nullable().optional(),
});

/**
 * Persist the pre-selected payer / credit card for the Home tab's entry form.
 * Both fields are nullable — clearing either falls the home form back to
 * "first user" / "no payment method".
 *
 * Cross-household integrity: only members of the active household can set
 * these (requireSession ensures that), and only ids that belong to the same
 * household are accepted — RLS would reject mismatches but we surface a
 * friendlier error.
 */
export async function updateHouseholdDefaults(input: z.infer<typeof HouseholdDefaultsSchema>) {
  const { household } = await requireSession();
  const hid = household.household_id;
  const p = HouseholdDefaultsSchema.parse(input);
  const sb = getSupabaseServer();

  if (p.default_user_id) {
    const { data } = await sb
      .from("users")
      .select("id")
      .eq("household_id", hid)
      .eq("id", p.default_user_id)
      .maybeSingle();
    if (!data) throw new Error("指定された支払者がこの世帯に存在しません。");
  }
  if (p.default_payment_method_id) {
    const { data } = await sb
      .from("payment_methods")
      .select("id")
      .eq("household_id", hid)
      .eq("id", p.default_payment_method_id)
      .maybeSingle();
    if (!data) throw new Error("指定された支払方法がこの世帯に存在しません。");
  }

  const { error } = await sb
    .from("households")
    .update({
      default_user_id: p.default_user_id ?? null,
      default_payment_method_id: p.default_payment_method_id ?? null,
    })
    .eq("id", hid);
  if (error) throw new Error(error.message);

  revalidateTag(`hh:${hid}`);
}

/* -------------------- Users (payer labels) -------------------- */
export async function createUser(name: string) {
  const { household } = await requireSession();
  const hid = household.household_id;
  const trimmed = name.trim();
  if (!trimmed) throw new Error("名前を入力してください。");
  const sb = getSupabaseServer();
  const { error } = await sb.from("users").insert({ household_id: hid, name: trimmed });
  if (error) throw new Error(error.message);
  revalidateTag(`hh:${hid}:users`);
}

export async function renameUser(id: string, name: string) {
  const { household } = await requireSession();
  const hid = household.household_id;
  const trimmed = name.trim();
  if (!trimmed) throw new Error("名前を入力してください。");
  const sb = getSupabaseServer();
  const { error } = await sb
    .from("users")
    .update({ name: trimmed })
    .eq("household_id", hid)
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidateTag(`hh:${hid}:users`);
}

export async function updateUserColor(id: string, color_hex: string | null) {
  const { household } = await requireSession();
  const hid = household.household_id;
  const sb = getSupabaseServer();
  const { error } = await sb
    .from("users")
    .update({ color_hex })
    .eq("household_id", hid)
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidateTag(`hh:${hid}:users`);
}

export async function deleteUser(id: string) {
  const { household } = await requireSession();
  const hid = household.household_id;
  const sb = getSupabaseServer();
  const { count } = await sb
    .from("transactions")
    .select("id", { count: "exact", head: true })
    .eq("household_id", hid)
    .eq("user_id", id);
  if ((count ?? 0) > 0) {
    throw new Error("このユーザーには取引記録があるため削除できません。先に「統合」してください。");
  }
  const { error } = await sb.from("users").delete().eq("household_id", hid).eq("id", id);
  if (error) throw new Error(error.message);
  revalidateTag(`hh:${hid}:users`);
}

const MergeUserSchema = z.object({
  from_user_id: z.string().uuid(),
  to_user_id: z.string().uuid(),
});

/**
 * Move every reference from one user-label row to another inside the same
 * household, then delete the source. Use case: invite flow creates a fresh
 * `users` row for the new auth user, but the household has been tracking
 * spend against an older label — collapse them so the new authenticated
 * member owns the history.
 *
 * RLS keeps the writes scoped: we never touch rows outside the active
 * household, even with service-role bypass. The to_user must exist in the
 * same household; from_user is the row that disappears.
 */
export async function mergeUsers(input: z.infer<typeof MergeUserSchema>): Promise<{ moved: Record<string, number> }> {
  const { household } = await requireSession();
  if (household.role !== "owner") throw new Error("メンバーの統合はオーナーのみ可能です。");
  const p = MergeUserSchema.parse(input);
  if (p.from_user_id === p.to_user_id) throw new Error("同じユーザーは統合できません。");
  const hid = household.household_id;
  const admin = getSupabaseAdmin();

  const { data: both } = await admin
    .from("users")
    .select("id, name, auth_user_id")
    .eq("household_id", hid)
    .in("id", [p.from_user_id, p.to_user_id]);
  const rows = (both ?? []) as { id: string; name: string; auth_user_id: string | null }[];
  if (rows.length !== 2) throw new Error("統合元または統合先がこの世帯に存在しません。");

  const moved: Record<string, number> = {};
  const move = async (table: string) => {
    const { data, error } = await admin
      .from(table)
      .update({ user_id: p.to_user_id })
      .eq("household_id", hid)
      .eq("user_id", p.from_user_id)
      .select("id");
    if (error) throw new Error(`${table}: ${error.message}`);
    moved[table] = data?.length ?? 0;
  };
  await move("transactions");
  await move("fixed_cost_masters");
  await move("payment_methods");
  await move("investment_accounts");
  await move("investment_transactions");

  // Households can also point at a default user. Re-link if it was the merged-away row.
  await admin
    .from("households")
    .update({ default_user_id: p.to_user_id })
    .eq("id", hid)
    .eq("default_user_id", p.from_user_id);

  const { error: delErr } = await admin
    .from("users")
    .delete()
    .eq("household_id", hid)
    .eq("id", p.from_user_id);
  if (delErr) throw new Error(`users: ${delErr.message}`);

  revalidateTag(`hh:${hid}:users`);
  revalidateTag(`hh:${hid}:transactions`);
  revalidateTag(`hh:${hid}:fixed-cost-masters`);
  revalidateTag(`hh:${hid}:payment-methods`);
  revalidateTag(`hh:${hid}:investment-accounts`);
  return { moved };
}

/* -------------------- Categories -------------------- */
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

const CategorySchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(40),
  type: z.enum(["shared", "personal"]),
  budget_amount: z.number().int().min(0),
  sort_order: z.number().int().default(0),
  is_active: z.boolean().default(true),
  color_hex: z.string().regex(HEX_RE).nullable().optional(),
});

export async function upsertCategory(input: z.infer<typeof CategorySchema>) {
  const { household } = await requireSession();
  const hid = household.household_id;
  const p = CategorySchema.parse(input);
  const sb = getSupabaseServer();
  const payload = {
    name: p.name,
    type: p.type,
    budget_amount: p.budget_amount,
    sort_order: p.sort_order,
    is_active: p.is_active,
    ...(p.color_hex !== undefined ? { color_hex: p.color_hex } : {}),
  };
  if (p.id) {
    const { error } = await sb
      .from("expense_categories")
      .update(payload)
      .eq("household_id", hid)
      .eq("id", p.id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await sb.from("expense_categories").insert({
      household_id: hid,
      ...payload,
    });
    if (error) throw new Error(error.message);
  }
  revalidateTag(`hh:${hid}:categories`);
}

const KindColorSchema = z.object({
  kind: z.enum([
    "income",
    "fixed",
    "loan",
    "special",
    "advance",
    "investment",
    "transfer_in",
    "transfer_out",
  ]),
  color_hex: z.string().regex(HEX_RE),
});

export async function upsertKindColor(input: z.infer<typeof KindColorSchema>) {
  const { household } = await requireSession();
  const hid = household.household_id;
  const p = KindColorSchema.parse(input);
  const sb = getSupabaseServer();
  const { error } = await sb
    .from("kind_colors")
    .upsert(
      { household_id: hid, kind: p.kind, color_hex: p.color_hex },
      { onConflict: "household_id,kind" },
    );
  if (error) throw new Error(error.message);
  revalidateTag(`hh:${hid}:kind-colors`);
}

export async function deleteCategory(id: string) {
  const { household } = await requireSession();
  const hid = household.household_id;
  const sb = getSupabaseServer();
  const { error } = await sb
    .from("expense_categories")
    .delete()
    .eq("household_id", hid)
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidateTag(`hh:${hid}:categories`);
}

export async function reorderCategories(ids: string[]) {
  const { household } = await requireSession();
  const hid = household.household_id;
  const sb = getSupabaseServer();
  await Promise.all(
    ids.map((id, idx) =>
      sb
        .from("expense_categories")
        .update({ sort_order: (idx + 1) * 10 })
        .eq("household_id", hid)
        .eq("id", id),
    ),
  );
  revalidateTag(`hh:${hid}:categories`);
}

/* -------------------- Fixed cost masters -------------------- */
const FixedSchema = z.object({
  id: z.string().uuid().optional(),
  label: z.string().min(1).max(40),
  name: z.string().min(1).max(80),
  user_id: z.string().uuid().nullable().optional(),
  amount: z.number().int().min(0),
  valid_from_month: z.string().regex(/^\d{4}-\d{2}$/),
  notes: z.string().max(400).nullable().optional(),
  payment_method_id: z.string().uuid().nullable().optional(),
  payment_day: z.number().int().min(1).max(31).nullable().optional(),
});

export async function upsertFixedCost(input: z.infer<typeof FixedSchema>) {
  const { household } = await requireSession();
  const hid = household.household_id;
  const p = FixedSchema.parse(input);
  const sb = getSupabaseServer();
  const row = {
    household_id: hid,
    label: p.label,
    name: p.name,
    user_id: p.user_id ?? null,
    amount: p.amount,
    valid_from: firstOfMonth(p.valid_from_month),
    notes: p.notes ?? null,
    payment_method_id: p.payment_method_id ?? null,
    payment_day: p.payment_day ?? null,
  };
  let masterId: string | undefined = p.id;
  if (p.id) {
    const { error } = await sb
      .from("fixed_cost_masters")
      .update(row)
      .eq("household_id", hid)
      .eq("id", p.id);
    if (error) throw new Error(error.message);
  } else {
    const { data, error } = await sb
      .from("fixed_cost_masters")
      .insert(row)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    masterId = data?.id as string | undefined;
  }
  if (masterId) {
    try {
      await regenerateFixedCostForMaster(hid, masterId, 2);
    } catch (e) {
      console.error("regenerateFixedCostForMaster failed:", e);
    }
  }
  revalidateTag(`hh:${hid}:fixed-cost-masters`);
  revalidateTag(`hh:${hid}:transactions`);
}

export async function deleteFixedCost(id: string) {
  const { household } = await requireSession();
  const hid = household.household_id;
  const sb = getSupabaseServer();
  const { error } = await sb
    .from("fixed_cost_masters")
    .delete()
    .eq("household_id", hid)
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidateTag(`hh:${hid}:fixed-cost-masters`);
}

export async function setFixedCostArchived(id: string, archived: boolean) {
  const { household } = await requireSession();
  const hid = household.household_id;
  const sb = getSupabaseServer();
  const { error } = await sb
    .from("fixed_cost_masters")
    .update({ archived })
    .eq("household_id", hid)
    .eq("id", id);
  if (error) throw new Error(error.message);
  // Archiving wipes upcoming auto-tx for this master so the cash-flow chart
  // and transactions list both stop showing it within seconds, not a month.
  try {
    await regenerateFixedCostForMaster(hid, id, 2);
  } catch (e) {
    console.error("regenerateFixedCostForMaster (archive) failed:", e);
  }
  revalidateTag(`hh:${hid}:fixed-cost-masters`);
  revalidateTag(`hh:${hid}:transactions`);
}

/* -------------------- Payment methods -------------------- */
const PaymentMethodSchema = z.object({
  id: z.string().uuid().optional(),
  user_id: z.string().uuid().nullable().optional(),
  name: z.string().min(1).max(40),
  type: z.enum(["cash", "transfer", "credit_card"]),
  closing_day: z.number().int().min(1).max(31).nullable().optional(),
  payment_day: z.number().int().min(1).max(31).nullable().optional(),
  payment_month_offset: z.number().int().min(0).max(6).default(1),
  bank_account_label: z.string().max(40).nullable().optional(),
  display_order: z.number().int().default(0),
  family_card_user_id: z.string().uuid().nullable().optional(),
});

export async function upsertPaymentMethod(input: z.infer<typeof PaymentMethodSchema>) {
  const { household } = await requireSession();
  const hid = household.household_id;
  const p = PaymentMethodSchema.parse(input);
  const sb = getSupabaseServer();
  const row = {
    household_id: hid,
    user_id: p.user_id ?? null,
    name: p.name,
    type: p.type,
    closing_day: p.type === "credit_card" ? p.closing_day ?? null : null,
    payment_day: p.type === "credit_card" ? p.payment_day ?? null : null,
    payment_month_offset: p.type === "credit_card" ? p.payment_month_offset : 0,
    bank_account_label: p.bank_account_label ?? null,
    display_order: p.display_order,
    family_card_user_id: p.type === "credit_card" ? p.family_card_user_id ?? null : null,
  };
  if (p.id) {
    const { error } = await sb
      .from("payment_methods")
      .update(row)
      .eq("household_id", hid)
      .eq("id", p.id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await sb.from("payment_methods").insert(row);
    if (error) throw new Error(error.message);
  }
  revalidateTag(`hh:${hid}:payment-methods`);
}

export async function archivePaymentMethod(id: string) {
  const { household } = await requireSession();
  const hid = household.household_id;
  const sb = getSupabaseServer();
  const { error } = await sb
    .from("payment_methods")
    .update({ archived: true })
    .eq("household_id", hid)
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidateTag(`hh:${hid}:payment-methods`);
}

export async function setPaymentMethodArchived(id: string, archived: boolean) {
  const { household } = await requireSession();
  const hid = household.household_id;
  const sb = getSupabaseServer();
  const { error } = await sb
    .from("payment_methods")
    .update({ archived })
    .eq("household_id", hid)
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidateTag(`hh:${hid}:payment-methods`);
}

export async function deletePaymentMethod(id: string) {
  const { household } = await requireSession();
  const hid = household.household_id;
  const sb = getSupabaseServer();
  const { count } = await sb
    .from("transactions")
    .select("id", { count: "exact", head: true })
    .eq("household_id", hid)
    .eq("payment_method_id", id);
  if ((count ?? 0) > 0) {
    const { error } = await sb
      .from("payment_methods")
      .update({ archived: true })
      .eq("household_id", hid)
      .eq("id", id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await sb
      .from("payment_methods")
      .delete()
      .eq("household_id", hid)
      .eq("id", id);
    if (error) throw new Error(error.message);
  }
  revalidateTag(`hh:${hid}:payment-methods`);
}

const BulkPmSchema = z.object({
  payment_method_id: z.string().uuid(),
  user_id: z.string().uuid().nullable().optional(),
  date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  only_unassigned: z.boolean().default(true),
});

export async function bulkAssignPaymentMethod(input: z.infer<typeof BulkPmSchema>): Promise<number> {
  const { household } = await requireSession();
  const hid = household.household_id;
  const p = BulkPmSchema.parse(input);
  if (p.date_from > p.date_to) throw new Error("開始日が終了日より後ろです。");
  const sb = getSupabaseServer();
  let q = sb
    .from("transactions")
    .update({ payment_method_id: p.payment_method_id })
    .eq("household_id", hid)
    .gte("date", p.date_from)
    .lte("date", p.date_to);
  if (p.user_id) q = q.eq("user_id", p.user_id);
  if (p.only_unassigned) q = q.is("payment_method_id", null);
  const { data, error } = await q.select("id");
  if (error) throw new Error(error.message);
  revalidateTag(`hh:${hid}:transactions`);
  return data?.length ?? 0;
}

/* -------------------- Cash balance snapshots -------------------- */
const CashBalanceSchema = z.object({
  as_of_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  balance: z.number().int(),
  note: z.string().max(200).nullable().optional(),
});

export async function upsertCashBalance(input: z.infer<typeof CashBalanceSchema>) {
  const { household } = await requireSession();
  const hid = household.household_id;
  const p = CashBalanceSchema.parse(input);
  const sb = getSupabaseServer();
  const { error } = await sb.from("cash_balance_snapshots").insert({
    household_id: hid,
    as_of_date: p.as_of_date,
    balance: p.balance,
    note: p.note ?? null,
  });
  if (error) throw new Error(error.message);
  revalidateTag(`hh:${hid}:cash-balance`);
}

export async function deleteCashBalance(id: string) {
  const { household } = await requireSession();
  const hid = household.household_id;
  const sb = getSupabaseServer();
  const { error } = await sb
    .from("cash_balance_snapshots")
    .delete()
    .eq("household_id", hid)
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidateTag(`hh:${hid}:cash-balance`);
}

/* -------------------- Household settings + invitations -------------------- */
const RenameHouseholdSchema = z.object({
  name: z.string().min(1).max(60),
});

export async function renameHousehold(input: z.infer<typeof RenameHouseholdSchema>) {
  const { household } = await requireSession();
  if (household.role !== "owner") throw new Error("世帯名の変更はオーナーのみ可能です。");
  const p = RenameHouseholdSchema.parse(input);
  const sb = getSupabaseServer();
  const { error } = await sb
    .from("households")
    .update({ name: p.name })
    .eq("id", household.household_id);
  if (error) throw new Error(error.message);
  revalidateTag(`hh:${household.household_id}`);
}

const InviteSchema = z.object({
  email: z.string().email().max(120),
  role: z.enum(["owner", "editor", "viewer"]).default("editor"),
});

export async function inviteMember(input: z.infer<typeof InviteSchema>) {
  const { user, household } = await requireSession();
  if (household.role !== "owner") throw new Error("メンバーの招待はオーナーのみ可能です。");
  const p = InviteSchema.parse(input);
  const token = randomBytes(24).toString("base64url");

  const admin = getSupabaseAdmin();
  const { error } = await admin.from("household_invitations").insert({
    household_id: household.household_id,
    email: p.email.toLowerCase(),
    role: p.role,
    token,
    invited_by: user.id,
  });
  if (error) throw new Error(error.message);
  return { token };
}

const OpenInviteSchema = z.object({
  role: z.enum(["owner", "editor", "viewer"]).default("editor"),
});

/**
 * Create an "open" invitation that is not tied to a specific email address.
 * The owner shares the resulting URL via any channel, and whoever opens it
 * can sign up with their own email/password and join this household.
 */
export async function createOpenInvite(input: z.infer<typeof OpenInviteSchema>) {
  const { user, household } = await requireSession();
  if (household.role !== "owner") throw new Error("リンクの発行はオーナーのみ可能です。");
  const p = OpenInviteSchema.parse(input);
  const token = randomBytes(24).toString("base64url");
  const admin = getSupabaseAdmin();
  const { error } = await admin.from("household_invitations").insert({
    household_id: household.household_id,
    email: "",
    role: p.role,
    token,
    invited_by: user.id,
  });
  if (error) throw new Error(error.message);
  return { token };
}

export async function revokeInvitation(id: string) {
  const { household } = await requireSession();
  if (household.role !== "owner") throw new Error("招待の取り消しはオーナーのみ可能です。");
  const admin = getSupabaseAdmin();
  const { error } = await admin
    .from("household_invitations")
    .delete()
    .eq("id", id)
    .eq("household_id", household.household_id);
  if (error) throw new Error(error.message);
}

export async function removeMember(authUserId: string) {
  const { user, household } = await requireSession();
  if (household.role !== "owner" && authUserId !== user.id) {
    throw new Error("他のメンバーの削除はオーナーのみ可能です。");
  }
  const admin = getSupabaseAdmin();

  // Guard: never let the only owner be removed (would orphan the household).
  if (authUserId === user.id || household.role === "owner") {
    const { data: owners } = await admin
      .from("household_members")
      .select("auth_user_id")
      .eq("household_id", household.household_id)
      .eq("role", "owner");
    const ownerIds = ((owners ?? []) as { auth_user_id: string }[]).map((o) => o.auth_user_id);
    if (ownerIds.length === 1 && ownerIds[0] === authUserId) {
      throw new Error(
        "唯一のオーナーは削除できません。他のメンバーをオーナーに昇格させてから再実行してください。",
      );
    }
  }

  const { error } = await admin
    .from("household_members")
    .delete()
    .eq("household_id", household.household_id)
    .eq("auth_user_id", authUserId);
  if (error) throw new Error(error.message);
}

const ChangeRoleSchema = z.object({
  authUserId: z.string().uuid(),
  role: z.enum(["owner", "editor", "viewer"]),
});

export async function changeMemberRole(input: z.infer<typeof ChangeRoleSchema>) {
  const { household } = await requireSession();
  if (household.role !== "owner") throw new Error("ロール変更はオーナーのみ可能です。");
  const p = ChangeRoleSchema.parse(input);
  const admin = getSupabaseAdmin();
  const { error } = await admin
    .from("household_members")
    .update({ role: p.role })
    .eq("household_id", household.household_id)
    .eq("auth_user_id", p.authUserId);
  if (error) throw new Error(error.message);
}

export interface MemberRow {
  auth_user_id: string;
  role: "owner" | "editor" | "viewer";
  display_name: string | null;
  email: string | null;
  joined_at: string;
}

export async function listMembers(): Promise<MemberRow[]> {
  const { household } = await requireSession();
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("household_members")
    .select("auth_user_id, role, display_name, joined_at")
    .eq("household_id", household.household_id)
    .order("joined_at");
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as Omit<MemberRow, "email">[];
  // Look up emails one-by-one (Supabase admin API has no bulk-by-id endpoint).
  // For typical household sizes (1–5 members) this is fine.
  const out: MemberRow[] = [];
  for (const r of rows) {
    const { data: au } = await admin.auth.admin.getUserById(r.auth_user_id);
    out.push({ ...r, email: au?.user?.email ?? null });
  }
  return out;
}

export interface InvitationRow {
  id: string;
  email: string;
  role: "owner" | "editor" | "viewer";
  token: string;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
}

export async function listInvitations(): Promise<InvitationRow[]> {
  const { household } = await requireSession();
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("household_invitations")
    .select("id, email, role, token, expires_at, accepted_at, created_at")
    .eq("household_id", household.household_id)
    .is("accepted_at", null)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as InvitationRow[];
}

export async function switchHousehold(householdId: string) {
  const { memberships } = await requireSession();
  if (!memberships.some((m) => m.household_id === householdId)) {
    throw new Error("その世帯のメンバーではありません。");
  }
  cookies().set({
    name: HOUSEHOLD_COOKIE,
    value: householdId,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}
