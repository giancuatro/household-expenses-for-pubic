-- ============================================================================
--  Phase 3 — Payment methods
--  Track cash / bank-transfer / credit-card lines so we can attribute each
--  transaction to a specific funding source and reason about credit-card
--  billing cycles (closing day → settlement day).
-- ============================================================================

create type payment_method_type as enum ('cash', 'transfer', 'credit_card');

create table if not exists payment_methods (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid references users(id) on delete set null, -- null = 世帯共有
  name                  text not null,
  type                  payment_method_type not null,
  -- For credit cards: closing day of month (1..31, 31 means "末日").
  closing_day           smallint check (closing_day is null or (closing_day between 1 and 31)),
  -- Day of month the bank withdraws (1..31).
  payment_day           smallint check (payment_day is null or (payment_day between 1 and 31)),
  -- Months between the closing date and the bank withdrawal (typically 1, View=2).
  payment_month_offset  smallint not null default 1 check (payment_month_offset between 0 and 6),
  -- Free-form label for the bill-from account (e.g. "三菱UFJ").
  bank_account_label    text,
  display_order         integer not null default 0,
  archived              boolean not null default false,
  created_at            timestamptz not null default now()
);

create index if not exists idx_payment_methods_user on payment_methods (user_id) where archived = false;

-- Each transaction may carry a payment method. Existing rows stay NULL = "未分類 (現金扱い)".
alter table transactions
  add column if not exists payment_method_id uuid references payment_methods(id) on delete set null;

create index if not exists idx_transactions_pm_date on transactions (payment_method_id, date);

-- ---------------------------------------------------------------------------
-- (No global payment-method seed.)
-- Each user adds their own payment methods through the Settings UI after
-- signing up. Pre-Phase-1 deployments seeded a few generic 現金/振込/カード
-- rows here, but with multi-tenant scoping that creates orphaned rows in
-- fresh installs.
-- ---------------------------------------------------------------------------
