-- ============================================================================
--  Household Expense — Initial schema
--  Run this in Supabase SQL editor (or `supabase db push`).
--  All amounts are stored as INTEGER (JPY, no decimals).
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- users (payers)
-- ---------------------------------------------------------------------------
create table if not exists users (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- expense_categories
-- ---------------------------------------------------------------------------
create type category_kind as enum ('shared', 'personal');

create table if not exists expense_categories (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  type           category_kind not null,
  budget_amount  integer not null default 0,
  is_active      boolean not null default true,
  sort_order     integer not null default 0,
  created_at     timestamptz not null default now(),
  unique (name, type)
);

-- ---------------------------------------------------------------------------
-- fixed_cost_masters
--   valid_from is stored as DATE (first day of month) — e.g. 2026-04-01
-- ---------------------------------------------------------------------------
create table if not exists fixed_cost_masters (
  id          uuid primary key default gen_random_uuid(),
  label       text not null,                         -- 固定費 / ローン / <ユーザー名>固定費 等
  name        text not null,                         -- 家賃、Netflix 等
  user_id     uuid references users(id) on delete set null,  -- null = 共同
  amount      integer not null,
  valid_from  date not null,                         -- YYYY-MM-01
  notes       text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_fixed_cost_masters_valid on fixed_cost_masters (name, user_id, valid_from);

-- ---------------------------------------------------------------------------
-- transactions
-- ---------------------------------------------------------------------------
create type txn_kind as enum (
  'income', 'fixed', 'loan', 'variable', 'personal',
  'transfer_in', 'transfer_out', 'special', 'investment'
);

create table if not exists transactions (
  id                 uuid primary key default gen_random_uuid(),
  date               date not null,
  user_id            uuid not null references users(id) on delete restrict,
  amount             integer not null,
  category_type      txn_kind not null,
  category_id        uuid references expense_categories(id) on delete set null,
  subcategory        text,
  note               text,
  is_advance_payment boolean not null default false,
  advance_settled    boolean not null default false,
  source             text,                         -- 'manual' | 'fixed-auto' | 'investment-auto'
  source_ref         text,                         -- dedupe key for auto-insertions
  created_at         timestamptz not null default now()
);
create index if not exists idx_transactions_date on transactions (date);
create index if not exists idx_transactions_user on transactions (user_id);
create index if not exists idx_transactions_cat  on transactions (category_id);
create unique index if not exists uq_transactions_source_ref
  on transactions (source_ref) where source_ref is not null;

-- ---------------------------------------------------------------------------
-- investment_accounts / holdings / transactions
-- ---------------------------------------------------------------------------
create table if not exists investment_accounts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  provider      text not null,            -- 'rakuten' | 'sbi' | 'manual'
  api_key       text,                     -- store encrypted in app layer
  account_name  text not null,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

create table if not exists investment_holdings (
  id                  uuid primary key default gen_random_uuid(),
  account_id          uuid not null references investment_accounts(id) on delete cascade,
  fetched_at          timestamptz not null default now(),
  ticker              text not null,
  name                text,
  quantity            numeric(20, 6) not null,
  avg_cost_usd        numeric(20, 4) not null default 0,
  current_price_usd   numeric(20, 4) not null default 0,
  exchange_rate       numeric(12, 4) not null default 150,  -- JPY per 1 USD
  total_value_jpy     integer not null default 0,
  unrealized_gain_jpy integer not null default 0
);
create index if not exists idx_holdings_account on investment_holdings (account_id, fetched_at desc);

create table if not exists investment_transactions (
  id                    uuid primary key default gen_random_uuid(),
  date                  date not null,
  user_id               uuid not null references users(id) on delete restrict,
  ticker                text not null,
  name                  text,
  action                text not null check (action in ('buy', 'sell')),
  quantity              numeric(20, 6) not null,
  price_usd             numeric(20, 4) not null,
  exchange_rate         numeric(12, 4) not null,
  amount_jpy            integer not null,
  linked_transaction_id uuid references transactions(id) on delete set null,
  note                  text,
  created_at            timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- (No global seed data here.)
-- A new household + its default payer label and categories are bootstrapped
-- per-user inside src/app/auth/callback/route.ts when a fresh sign-up
-- completes. Keeping this migration as schema-only avoids polluting fresh
-- OSS installations with placeholder rows.
-- ---------------------------------------------------------------------------
