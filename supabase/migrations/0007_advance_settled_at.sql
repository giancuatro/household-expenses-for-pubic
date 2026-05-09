-- ============================================================================
--  Phase 5.x — advance_settled_at
--
--  Track WHEN an advance payment was settled (i.e. the friend paid us back).
--  The cash-flow projection uses this to add an inflow event on that date,
--  so the predicted cash balance reflects the actual money received.
--
--  Backfill: any rows already marked advance_settled=true get advance_settled_at
--  defaulted to the transaction date (best-effort — the user can edit later).
-- ============================================================================

alter table transactions
  add column if not exists advance_settled_at date;

update transactions
  set advance_settled_at = date
  where advance_settled = true and advance_settled_at is null;
