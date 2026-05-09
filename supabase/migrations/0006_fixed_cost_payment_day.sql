-- ============================================================================
--  Phase 4.1 — Fixed-cost payment_day
--
--  Each fixed cost can specify the day-of-month it actually leaves the bank
--  (e.g. 27 for 家賃, 5 for 電気代). When set, the auto-generated transaction
--  uses this day instead of the default cycle-start date so the cash-flow
--  projection lands on the real withdrawal date.
-- ============================================================================

alter table fixed_cost_masters
  add column if not exists payment_day smallint
    check (payment_day is null or (payment_day between 1 and 31));
