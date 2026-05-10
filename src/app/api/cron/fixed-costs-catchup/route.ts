import { NextRequest, NextResponse } from "next/server";
import { applyFixedCostsCatchUp } from "@/lib/fixedCosts";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Per-household catch-up. Iterates all households so the daily Vercel Cron
 * keeps each one's fixed-cost rows current. Bypasses RLS via service role.
 */
export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  // Fail closed when CRON_SECRET isn't configured — anonymous traffic should
  // never be able to spin through every household and rewrite fixed-cost rows.
  if (!expected) {
    return NextResponse.json({ ok: false, error: "cron not configured" }, { status: 503 });
  }
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${expected}`) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const admin = getSupabaseAdmin();
  const { data: households } = await admin.from("households").select("id");
  const out: Record<string, unknown> = {};
  for (const h of (households ?? []) as { id: string }[]) {
    out[h.id] = await applyFixedCostsCatchUp(h.id, 3);
  }
  return NextResponse.json({ ok: true, results: out });
}
