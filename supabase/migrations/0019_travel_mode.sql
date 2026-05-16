-- ============================================================================
--  Phase 7 — Travel mode (multi-currency entry + post-import FX finalization)
--
--  While abroad the user records purchases in the local currency; the credit-
--  card's exchange rate isn't known for days or weeks. This migration adds:
--
--    trips                       — a lightweight session that pins
--                                  (default_currency, est_rate) for the
--                                  entries created during the trip.
--    transactions.original_*     — the foreign-currency face value, the
--                                  estimated rate, and a fx_status flag
--                                  ('pending' until the card statement
--                                  finalizes the JPY amount).
--
--  Invariant: transactions.amount is ALWAYS integer JPY — pending rows just
--  store an estimate (round(original_amount * fx_rate)) so cashflow,
--  budgets, dashboards work unchanged. When the reconcile step matches the
--  card row, we overwrite `amount` with the card's confirmed JPY and back-
--  compute the actual fx_rate.
-- ============================================================================

create table if not exists trips (
  id                  uuid primary key default gen_random_uuid(),
  household_id        uuid not null references households(id) on delete cascade,
  name                text not null,
  default_currency    text not null,                  -- ISO 4217 like "TWD", "USD"
  est_rate            numeric(12,4) not null,         -- JPY per 1 unit of default_currency
  started_at          date not null,
  ended_at            date,                           -- NULL = currently active
  created_at          timestamptz not null default now()
);

-- Partial index so getActiveTrip() is O(1).
create index if not exists idx_trips_household_active
  on trips (household_id, started_at desc)
  where ended_at is null;

create index if not exists idx_trips_household_all
  on trips (household_id, started_at desc);

alter table trips enable row level security;
drop policy if exists trips_household_all on trips;
create policy trips_household_all on trips
  for all using (household_id in (select current_household_ids()))
       with check (household_id in (select current_household_ids()));

-- ---------------------------------------------------------------------------
-- transactions: foreign-currency columns + trip back-reference
-- ---------------------------------------------------------------------------
alter table transactions
  add column if not exists original_amount   numeric(14,4),
  add column if not exists original_currency text,
  add column if not exists fx_rate           numeric(12,4),
  add column if not exists fx_status         text
    check (fx_status is null or fx_status in ('pending', 'finalized')),
  add column if not exists trip_id           uuid references trips(id) on delete set null;

-- Quickly enumerate unsettled FX rows for the dashboard banner + reconcile
-- pass 1.5 (foreign-currency matcher).
create index if not exists idx_txn_fx_pending
  on transactions (household_id, date)
  where fx_status = 'pending';

create index if not exists idx_txn_trip
  on transactions (trip_id)
  where trip_id is not null;
