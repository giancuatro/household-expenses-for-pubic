-- Security-advisor remediation (non-breaking).
--
-- 1. Pin search_path on the flagged trigger function.
-- 2. Revoke EXECUTE on the two SECURITY DEFINER *trigger* functions from
--    anon/authenticated — triggers fire as the table owner, so this does not
--    affect their operation, it only removes the pointless /rpc surface.
--    `current_household_ids()` is intentionally left executable: it is called
--    by the RLS policies themselves (as authenticated) and returns an empty
--    set for anon, so it leaks nothing.
-- 3. Wrap `auth.uid()` in a scalar subselect in the household/member policies
--    so Postgres evaluates it once per statement (auth_rls_initplan perf).

-- 1 --------------------------------------------------------------------------
alter function public.track_fixed_auto_dismissal() set search_path = public;

-- 2 --------------------------------------------------------------------------
revoke execute on function public.rls_auto_enable() from anon, authenticated;
revoke execute on function public.track_fixed_auto_dismissal() from anon, authenticated;

-- 3 --------------------------------------------------------------------------
alter policy households_owner_update on households
  using (exists (
    select 1 from household_members
    where household_members.household_id = households.id
      and household_members.auth_user_id = (select auth.uid())
      and household_members.role = 'owner'));

alter policy households_authenticated_insert on households
  with check ((select auth.uid()) is not null);

alter policy members_self_select on household_members
  using ((auth_user_id = (select auth.uid()))
         or (household_id in (select current_household_ids())));

alter policy members_owner_insert on household_members
  with check (((select auth.uid()) is not null)
    and ((auth_user_id = (select auth.uid()))
      or exists (select 1 from household_members hm
        where hm.household_id = household_members.household_id
          and hm.auth_user_id = (select auth.uid())
          and hm.role = 'owner')));

alter policy members_owner_delete on household_members
  using ((auth_user_id = (select auth.uid()))
    or exists (select 1 from household_members hm
      where hm.household_id = household_members.household_id
        and hm.auth_user_id = (select auth.uid())
        and hm.role = 'owner'));

alter policy invitations_owner_write on household_invitations
  using (exists (select 1 from household_members hm
    where hm.household_id = household_invitations.household_id
      and hm.auth_user_id = (select auth.uid())
      and hm.role = any (array['owner', 'editor'])))
  with check (exists (select 1 from household_members hm
    where hm.household_id = household_invitations.household_id
      and hm.auth_user_id = (select auth.uid())
      and hm.role = any (array['owner', 'editor'])));

alter policy fcd_member on fixed_cost_dismissals
  using (exists (select 1 from household_members
    where household_members.household_id = fixed_cost_dismissals.household_id
      and household_members.auth_user_id = (select auth.uid())))
  with check (exists (select 1 from household_members
    where household_members.household_id = fixed_cost_dismissals.household_id
      and household_members.auth_user_id = (select auth.uid())));
