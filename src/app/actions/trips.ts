"use server";

import { revalidateTag } from "next/cache";
import { z } from "zod";
import { getSupabaseServer } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth";

/**
 * Phase 7 — Travel mode actions.
 *
 * A "trip" is a lightweight session: while one is active, the home entry
 * form switches to foreign-currency mode and prefills (currency, est_rate).
 * Pending FX transactions can be re-estimated in bulk when the user revises
 * the trip's est_rate.
 */

const StartSchema = z.object({
  name: z.string().min(1).max(80),
  default_currency: z.string().min(2).max(8),
  est_rate: z.number().positive().max(100_000),
  started_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function startTrip(input: z.infer<typeof StartSchema>) {
  const { household } = await requireSession();
  const hid = household.household_id;
  const parsed = StartSchema.parse(input);
  const sb = getSupabaseServer();

  // Only one active trip at a time — keeps the home-form UX unambiguous.
  const { data: existing } = await sb
    .from("trips")
    .select("id")
    .eq("household_id", hid)
    .is("ended_at", null)
    .limit(1)
    .maybeSingle();
  if (existing) {
    throw new Error("既に進行中の旅行があります。先に終了してから新しい旅行を開始してください。");
  }

  const { data, error } = await sb
    .from("trips")
    .insert({
      household_id: hid,
      name: parsed.name,
      default_currency: parsed.default_currency.toUpperCase(),
      est_rate: parsed.est_rate,
      started_at: parsed.started_at,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  revalidateTag(`hh:${hid}:trips`);
  return { id: data.id as string };
}

const EndSchema = z.object({
  id: z.string().uuid(),
  ended_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export async function endTrip(input: z.infer<typeof EndSchema>) {
  const { household } = await requireSession();
  const hid = household.household_id;
  const parsed = EndSchema.parse(input);
  const sb = getSupabaseServer();

  const endedAt = parsed.ended_at ?? new Date().toISOString().slice(0, 10);
  const { error } = await sb
    .from("trips")
    .update({ ended_at: endedAt })
    .eq("household_id", hid)
    .eq("id", parsed.id);
  if (error) throw new Error(error.message);

  revalidateTag(`hh:${hid}:trips`);
}

const UpdateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(80).optional(),
  default_currency: z.string().min(2).max(8).optional(),
  est_rate: z.number().positive().max(100_000).optional(),
  started_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  ended_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

export async function updateTrip(input: z.infer<typeof UpdateSchema>) {
  const { household } = await requireSession();
  const hid = household.household_id;
  const parsed = UpdateSchema.parse(input);
  const sb = getSupabaseServer();

  const patch: Record<string, unknown> = {};
  if (parsed.name !== undefined) patch.name = parsed.name;
  if (parsed.default_currency !== undefined) patch.default_currency = parsed.default_currency.toUpperCase();
  if (parsed.est_rate !== undefined) patch.est_rate = parsed.est_rate;
  if (parsed.started_at !== undefined) patch.started_at = parsed.started_at;
  if (parsed.ended_at !== undefined) patch.ended_at = parsed.ended_at;

  if (Object.keys(patch).length === 0) return;

  const { error } = await sb
    .from("trips")
    .update(patch)
    .eq("household_id", hid)
    .eq("id", parsed.id);
  if (error) throw new Error(error.message);

  // If est_rate or default_currency changed, refresh estimated JPY for the
  // pending FX rows linked to this trip. Finalized rows stay untouched.
  if (parsed.est_rate !== undefined || parsed.default_currency !== undefined) {
    const { data: trip } = await sb
      .from("trips")
      .select("default_currency, est_rate")
      .eq("household_id", hid)
      .eq("id", parsed.id)
      .single();
    if (trip) {
      const { data: pendingRows } = await sb
        .from("transactions")
        .select("id, original_amount, original_currency")
        .eq("household_id", hid)
        .eq("trip_id", parsed.id)
        .eq("fx_status", "pending");
      for (const r of (pendingRows ?? []) as Array<{
        id: string;
        original_amount: number | null;
        original_currency: string | null;
      }>) {
        // Only re-estimate rows that share the trip's default currency; rows
        // entered in a side currency keep their own rate.
        if (!r.original_amount || r.original_currency !== trip.default_currency) continue;
        const newJpy = Math.round(r.original_amount * (trip.est_rate as number));
        await sb
          .from("transactions")
          .update({ amount: newJpy, fx_rate: trip.est_rate })
          .eq("household_id", hid)
          .eq("id", r.id);
      }
      revalidateTag(`hh:${hid}:transactions`);
    }
  }

  revalidateTag(`hh:${hid}:trips`);
}

export async function deleteTrip(id: string) {
  const { household } = await requireSession();
  const hid = household.household_id;
  const sb = getSupabaseServer();
  const { error } = await sb.from("trips").delete().eq("household_id", hid).eq("id", id);
  if (error) throw new Error(error.message);
  // The trip_id FK is ON DELETE SET NULL — linked transactions keep their
  // foreign-currency metadata, just lose the trip pointer.
  revalidateTag(`hh:${hid}:trips`);
  revalidateTag(`hh:${hid}:transactions`);
}
