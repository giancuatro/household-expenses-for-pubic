-- ============================================================================
--  Phase 5 — Fixed-cost safety net + family card / cardholder hookup
--
--  Two unrelated bundles, shipped together to avoid migration churn:
--
--  (a) Fixed-cost safety. The cron applies fixed_cost_masters once per
--      20-day cycle. Today the only escape is to delete the master, which
--      also wipes future cycles. We add:
--        - fixed_cost_masters.archived: pause without deleting
--        - fixed_cost_dismissals: remember source_refs the user removed
--          (after-delete trigger) so the next cron run does NOT re-spawn
--          them
--
--  (b) Family-card user pinning. The existing parser captured the family-
--      card holder name into staging_card_transactions.cardholder, and
--      payment_methods has family_card_user_id, but neither was wired up.
--      This migration only guarantees the columns exist (idempotent) so
--      the parser + reconcile code can rely on them.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- (a) Fixed-cost safety
-- ---------------------------------------------------------------------------
alter table fixed_cost_masters
  add column if not exists archived boolean not null default false;

create index if not exists idx_fixed_cost_masters_active
  on fixed_cost_masters (household_id)
  where archived = false;

create table if not exists fixed_cost_dismissals (
  household_id  uuid not null references households(id) on delete cascade,
  source_ref    text not null,
  dismissed_at  timestamptz not null default now(),
  primary key (household_id, source_ref)
);

-- After-delete trigger: when a user deletes a fixed-auto transaction, remember
-- its source_ref so applyFixedCostsForMonth / regenerateFixedCostForMaster
-- skip it next time. Without this the daily cron would silently recreate any
-- auto-row the user has decided not to keep.
create or replace function track_fixed_auto_dismissal()
returns trigger as $$
begin
  if old.source = 'fixed-auto' and old.source_ref is not null then
    insert into fixed_cost_dismissals (household_id, source_ref)
    values (old.household_id, old.source_ref)
    on conflict do nothing;
  end if;
  return old;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_track_fixed_auto_dismissal on transactions;
create trigger trg_track_fixed_auto_dismissal
  after delete on transactions
  for each row
  execute function track_fixed_auto_dismissal();

alter table fixed_cost_dismissals enable row level security;

-- Mirror the transactions/fixed_cost_masters policy: members of the household
-- can read/write their own dismissals; admin (service role) bypasses.
drop policy if exists fcd_member on fixed_cost_dismissals;
create policy fcd_member on fixed_cost_dismissals
  for all
  using (
    exists (
      select 1 from household_members
      where household_members.household_id = fixed_cost_dismissals.household_id
        and household_members.auth_user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from household_members
      where household_members.household_id = fixed_cost_dismissals.household_id
        and household_members.auth_user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- (b) Family-card columns (idempotent — DB already has these in production)
-- ---------------------------------------------------------------------------
alter table payment_methods
  add column if not exists family_card_user_id uuid references users(id) on delete set null;

create index if not exists idx_pm_family_card_user
  on payment_methods (family_card_user_id)
  where family_card_user_id is not null;

alter table staging_card_transactions
  add column if not exists cardholder text;
