import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";

export async function POST() {
  const sb = getSupabaseServer();
  await sb.auth.signOut();
  return NextResponse.json({ ok: true });
}
