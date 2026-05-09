import { NextResponse } from "next/server";
import JSZip from "jszip";
import { requireSession } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DSAR — Data Subject Access Request: download every row owned by the
 * caller's active household as a single ZIP containing one JSON and one
 * CSV per table. Auth user metadata (email, sign-in history) is included
 * but limited to the caller's own auth.users row.
 *
 * The endpoint is gated by requireSession() so anonymous requests get
 * redirected to /login.
 */
export async function GET() {
  const { user, household } = await requireSession();
  const hid = household.household_id;
  const admin = getSupabaseAdmin();

  const tables = [
    "households",
    "household_members",
    "household_invitations",
    "users",
    "expense_categories",
    "fixed_cost_masters",
    "payment_methods",
    "transactions",
    "investment_accounts",
    "investment_holdings",
    "investment_transactions",
    "cash_balance_snapshots",
  ] as const;

  const zip = new JSZip();
  const dir = zip.folder(`household-expense-export-${hid.slice(0, 8)}`);
  if (!dir) return NextResponse.json({ error: "zip init failed" }, { status: 500 });

  const errors: { table: string; error: string }[] = [];

  for (const table of tables) {
    const query = admin.from(table).select("*");
    // households is the only table keyed by `id`, the rest by household_id
    const filtered = table === "households" ? query.eq("id", hid) : query.eq("household_id", hid);
    const { data, error } = await filtered;
    if (error) {
      errors.push({ table, error: error.message });
      continue;
    }
    const rows = (data ?? []) as Record<string, unknown>[];
    dir.file(`${table}.json`, JSON.stringify(rows, null, 2));
    dir.file(`${table}.csv`, toCsv(rows));
  }

  // Add caller's auth.users row (only their own — never others')
  const { data: authUser } = await admin.auth.admin.getUserById(user.id);
  if (authUser?.user) {
    const safe = {
      id: authUser.user.id,
      email: authUser.user.email,
      created_at: authUser.user.created_at,
      last_sign_in_at: authUser.user.last_sign_in_at,
      app_metadata: authUser.user.app_metadata,
      user_metadata: authUser.user.user_metadata,
    };
    dir.file("auth_user.json", JSON.stringify(safe, null, 2));
  }

  if (errors.length) dir.file("_errors.json", JSON.stringify(errors, null, 2));

  const readme = [
    "# 家計簿 — データエクスポート",
    "",
    `世帯 ID: ${hid}`,
    `世帯名: ${household.household.name}`,
    `エクスポート日時: ${new Date().toISOString()}`,
    "",
    "このアーカイブにはあなたが所属する世帯の全データが含まれています。",
    "各テーブルは JSON と CSV の 2 形式で保存されています。",
    "",
    "## テーブル一覧",
    ...tables.map((t) => `- ${t}.json / ${t}.csv`),
    "- auth_user.json — あなたの認証アカウント情報",
  ].join("\n");
  dir.file("README.md", readme);

  const buf = await zip.generateAsync({ type: "uint8array" });
  // Wrap in a fresh ArrayBuffer slice so the BodyInit type is satisfied.
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  const filename = `household-expense-export-${new Date().toISOString().slice(0, 10)}.zip`;
  return new NextResponse(ab, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

/** Minimal RFC 4180 CSV writer. Handles commas, quotes, newlines, and null. */
function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown) => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const out = [headers.join(",")];
  for (const r of rows) out.push(headers.map((h) => escape(r[h])).join(","));
  return out.join("\n");
}
