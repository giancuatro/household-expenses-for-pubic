-- ============================================================================
--  Phase 4 — Cash balance tracking + fixed-cost payment method
--
--  - cash_balance_snapshots: a single global "current cash on hand" log.
--    The user enters a starting balance manually; subsequent reality is
--    inferred by debiting card settlements and cash transactions, and
--    crediting income transactions. We keep history (one row per manual
--    correction) so we can re-anchor whenever the user reconciles.
--  - fixed_cost_masters.payment_method_id: link each fixed cost to a card /
--    bank so generated transactions inherit the payment method.
-- ============================================================================

create table if not exists cash_balance_snapshots (
  id          uuid primary key default gen_random_uuid(),
  as_of_date  date not null,
  balance     bigint not null,
  note        text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_cash_balance_snapshots_date
  on cash_balance_snapshots (as_of_date desc);

alter table fixed_cost_masters
  add column if not exists payment_method_id uuid
    references payment_methods(id) on delete set null;

create index if not exists idx_fixed_cost_masters_pm
  on fixed_cost_masters (payment_method_id);
