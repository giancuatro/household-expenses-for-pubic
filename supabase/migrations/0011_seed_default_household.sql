-- ============================================================================
--  Phase 1 (OSS) — Backfill existing single-household data
--
--  This is the bridge migration for a database that was originally created
--  with the single-tenant schema (0001..0007). It:
--   1. Creates one default household ("我が家") if none exists yet
--   2. Stamps every existing row with that household_id
--   3. Tightens constraints (household_id NOT NULL + scoped uniqueness)
--
--  After this migration runs, the deployer must associate their auth user
--  with the household by signing up and then running the helper SQL printed
--  by `scripts/claim_household.ts` (or the SQL block at the bottom of this
--  file, manually substituting the auth.users id).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Ensure exactly one default household exists for legacy data.
-- ---------------------------------------------------------------------------
do $$
declare
  default_household uuid;
  has_legacy_data boolean;
begin
  -- Only create a default household if there is legacy data that needs one
  -- AND no household exists yet. Otherwise this is a fresh install.
  select exists (
    select 1 from transactions where household_id is null
    union all select 1 from users where household_id is null
    union all select 1 from expense_categories where household_id is null
  ) into has_legacy_data;

  if not has_legacy_data then
    return;
  end if;

  select id into default_household from households order by created_at limit 1;

  if default_household is null then
    insert into households (id, name, currency, locale)
    values (gen_random_uuid(), '我が家', 'JPY', 'ja-JP')
    returning id into default_household;
  end if;

  -- 2) Stamp every existing row with the default household_id.
  update users                   set household_id = default_household where household_id is null;
  update expense_categories      set household_id = default_household where household_id is null;
  update fixed_cost_masters      set household_id = default_household where household_id is null;
  update payment_methods         set household_id = default_household where household_id is null;
  update transactions            set household_id = default_household where household_id is null;
  update investment_accounts     set household_id = default_household where household_id is null;
  update investment_transactions set household_id = default_household where household_id is null;
  update cash_balance_snapshots  set household_id = default_household where household_id is null;

  -- investment_holdings inherits via investment_accounts.account_id
  update investment_holdings h
     set household_id = a.household_id
    from investment_accounts a
   where h.account_id = a.id and h.household_id is null;
end $$;

-- ---------------------------------------------------------------------------
-- 3) Tighten constraints — only enforce NOT NULL once data exists.
--    (Skip for empty / fresh databases so first signup can populate.)
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from users) then
    alter table users alter column household_id set not null;
  end if;
  if exists (select 1 from expense_categories) then
    alter table expense_categories alter column household_id set not null;
  end if;
  if exists (select 1 from fixed_cost_masters) then
    alter table fixed_cost_masters alter column household_id set not null;
  end if;
  if exists (select 1 from payment_methods) then
    alter table payment_methods alter column household_id set not null;
  end if;
  if exists (select 1 from transactions) then
    alter table transactions alter column household_id set not null;
  end if;
  if exists (select 1 from investment_accounts) then
    alter table investment_accounts alter column household_id set not null;
  end if;
  if exists (select 1 from investment_holdings) then
    alter table investment_holdings alter column household_id set not null;
  end if;
  if exists (select 1 from investment_transactions) then
    alter table investment_transactions alter column household_id set not null;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4) Re-scope uniqueness constraints by household_id.
--    The original constraints were global (single-household assumption).
-- ---------------------------------------------------------------------------

-- users: name was globally unique → scope per household
alter table users drop constraint if exists users_name_key;
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'users_household_name_key'
  ) then
    alter table users add constraint users_household_name_key unique (household_id, name);
  end if;
end $$;

-- expense_categories: (name, type) was globally unique → scope per household
alter table expense_categories drop constraint if exists expense_categories_name_type_key;
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'expense_categories_household_name_type_key'
  ) then
    alter table expense_categories
      add constraint expense_categories_household_name_type_key
      unique (household_id, name, type);
  end if;
end $$;

-- transactions: source_ref was globally unique → scope per household
drop index if exists uq_transactions_source_ref;
create unique index if not exists uq_transactions_household_source_ref
  on transactions (household_id, source_ref) where source_ref is not null;

-- ---------------------------------------------------------------------------
-- HOW TO CLAIM THE LEGACY HOUSEHOLD AS AN AUTH USER
-- ---------------------------------------------------------------------------
-- After deployment, sign up with email magic link, then run this in the
-- Supabase SQL editor (replace <YOUR_AUTH_USER_ID> with the uuid from the
-- auth.users table; replace <HOUSEHOLD_ID> with the id from `select id, name
-- from households` — typically the "我が家" row).
--
--   insert into household_members (household_id, auth_user_id, role)
--   values ('<HOUSEHOLD_ID>', '<YOUR_AUTH_USER_ID>', 'owner');
--
-- ---------------------------------------------------------------------------
