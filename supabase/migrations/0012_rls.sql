-- ============================================================================
--  Phase 1 (OSS) — Row-Level Security policies
--
--  Strategy:
--   - Enable RLS on every data table.
--   - A SECURITY DEFINER helper `current_household_ids()` returns the set of
--     households the current auth.uid() belongs to. Using a function lets
--     us avoid auth.users → household_members joins inside policies (they
--     would re-trigger RLS recursion otherwise).
--   - Each table gets a single FOR ALL policy: row visible iff its
--     household_id is in the user's set. Server Actions must continue to
--     stamp household_id on inserts; the RLS WITH CHECK clause enforces it.
--   - Service-role connections bypass RLS entirely (used internally by the
--     server-side queries layer for caching reasons — see src/lib/queries).
--
--  After this migration, the anon key cannot read anything without a logged-in
--  Supabase Auth session. Make sure the app uses @supabase/ssr cookies.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Helper: set of household_ids the current authenticated user belongs to.
-- ---------------------------------------------------------------------------
create or replace function public.current_household_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select household_id
    from public.household_members
   where auth_user_id = auth.uid();
$$;

grant execute on function public.current_household_ids() to authenticated, anon;

-- ---------------------------------------------------------------------------
-- households / household_members / household_invitations
-- ---------------------------------------------------------------------------
alter table households enable row level security;
alter table household_members enable row level security;
alter table household_invitations enable row level security;

drop policy if exists households_member_select on households;
create policy households_member_select on households
  for select using (id in (select current_household_ids()));

drop policy if exists households_owner_update on households;
create policy households_owner_update on households
  for update using (
    exists (
      select 1 from household_members
       where household_id = households.id
         and auth_user_id = auth.uid()
         and role = 'owner'
    )
  );

-- Anyone authenticated can create a household (becomes the owner via
-- the signup Server Action which inserts the matching household_members row).
drop policy if exists households_authenticated_insert on households;
create policy households_authenticated_insert on households
  for insert with check (auth.uid() is not null);

drop policy if exists members_self_select on household_members;
create policy members_self_select on household_members
  for select using (
    auth_user_id = auth.uid()
    or household_id in (select current_household_ids())
  );

-- Insert: the owner of the household OR a brand-new household_id whose
-- creator is auth.uid() (bootstrap path during signup).
drop policy if exists members_owner_insert on household_members;
create policy members_owner_insert on household_members
  for insert with check (
    auth.uid() is not null
    and (
      auth_user_id = auth.uid()
      or exists (
        select 1 from household_members hm
         where hm.household_id = household_members.household_id
           and hm.auth_user_id = auth.uid()
           and hm.role = 'owner'
      )
    )
  );

drop policy if exists members_owner_delete on household_members;
create policy members_owner_delete on household_members
  for delete using (
    auth_user_id = auth.uid()
    or exists (
      select 1 from household_members hm
       where hm.household_id = household_members.household_id
         and hm.auth_user_id = auth.uid()
         and hm.role = 'owner'
    )
  );

drop policy if exists invitations_household_select on household_invitations;
create policy invitations_household_select on household_invitations
  for select using (household_id in (select current_household_ids()));

drop policy if exists invitations_owner_write on household_invitations;
create policy invitations_owner_write on household_invitations
  for all using (
    exists (
      select 1 from household_members hm
       where hm.household_id = household_invitations.household_id
         and hm.auth_user_id = auth.uid()
         and hm.role in ('owner','editor')
    )
  ) with check (
    exists (
      select 1 from household_members hm
       where hm.household_id = household_invitations.household_id
         and hm.auth_user_id = auth.uid()
         and hm.role in ('owner','editor')
    )
  );

-- ---------------------------------------------------------------------------
-- Data tables: identical "household_id IN (current_household_ids())" pattern.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  tables text[] := array[
    'users',
    'expense_categories',
    'fixed_cost_masters',
    'payment_methods',
    'transactions',
    'investment_accounts',
    'investment_holdings',
    'investment_transactions',
    'cash_balance_snapshots'
  ];
begin
  foreach t in array tables
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I_household_all on %I', t, t);
    execute format(
      'create policy %I_household_all on %I '
      'for all using (household_id in (select current_household_ids())) '
      'with check (household_id in (select current_household_ids()))',
      t, t
    );
  end loop;
end $$;
