-- ============================================================================
--  Phase 1 (OSS) — Multi-tenant schema
--
--  Convert the single-household design into a multi-household SaaS shape so
--  that any number of users can self-host or share an instance and only see
--  their own household's data.
--
--  - households: one row per shared household ledger
--  - household_members: links Supabase auth.users → households (with role)
--  - household_invitations: email-based invite tokens for adding members
--  - All data tables get a household_id column (nullable until backfilled)
--
--  Data backfill happens in 0011_seed_default_household.sql so this file is
--  a pure schema change and can be reviewed independently.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- households
-- ---------------------------------------------------------------------------
create table if not exists households (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  currency    char(3) not null default 'JPY',
  locale      text not null default 'ja-JP',
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- household_members  (auth.users  ↔  households, with role)
-- ---------------------------------------------------------------------------
create table if not exists household_members (
  household_id  uuid not null references households(id) on delete cascade,
  auth_user_id  uuid not null references auth.users(id) on delete cascade,
  role          text not null check (role in ('owner','editor','viewer')) default 'editor',
  display_name  text,
  joined_at     timestamptz not null default now(),
  primary key (household_id, auth_user_id)
);
create index if not exists idx_household_members_user on household_members (auth_user_id);

-- ---------------------------------------------------------------------------
-- household_invitations (email-based magic link invites)
-- ---------------------------------------------------------------------------
create table if not exists household_invitations (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references households(id) on delete cascade,
  email         text not null,
  role          text not null check (role in ('owner','editor','viewer')) default 'editor',
  token         text not null unique,
  invited_by    uuid references auth.users(id) on delete set null,
  expires_at    timestamptz not null default (now() + interval '14 days'),
  accepted_at   timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists idx_invitations_household on household_invitations (household_id);
create index if not exists idx_invitations_email on household_invitations (lower(email));

-- ---------------------------------------------------------------------------
-- Add household_id to every data table (NULLABLE for now; 0011 backfills)
-- ---------------------------------------------------------------------------
alter table users                  add column if not exists household_id uuid references households(id) on delete cascade;
alter table users                  add column if not exists auth_user_id uuid references auth.users(id) on delete set null;
alter table expense_categories     add column if not exists household_id uuid references households(id) on delete cascade;
alter table fixed_cost_masters     add column if not exists household_id uuid references households(id) on delete cascade;
alter table payment_methods        add column if not exists household_id uuid references households(id) on delete cascade;
alter table transactions           add column if not exists household_id uuid references households(id) on delete cascade;
alter table investment_accounts    add column if not exists household_id uuid references households(id) on delete cascade;
alter table investment_holdings    add column if not exists household_id uuid references households(id) on delete cascade;
alter table investment_transactions add column if not exists household_id uuid references households(id) on delete cascade;
alter table cash_balance_snapshots add column if not exists household_id uuid references households(id) on delete cascade;

create index if not exists idx_users_household on users (household_id);
create index if not exists idx_categories_household on expense_categories (household_id);
create index if not exists idx_fixed_household on fixed_cost_masters (household_id);
create index if not exists idx_pm_household on payment_methods (household_id);
create index if not exists idx_txn_household on transactions (household_id);
create index if not exists idx_inv_acc_household on investment_accounts (household_id);
create index if not exists idx_inv_hold_household on investment_holdings (household_id);
create index if not exists idx_inv_txn_household on investment_transactions (household_id);
create index if not exists idx_cash_household on cash_balance_snapshots (household_id);
