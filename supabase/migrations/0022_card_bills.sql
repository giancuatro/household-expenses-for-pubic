-- ============================================================================
--  Confirmed card bills — the amount that actually debits the bank account.
--
--  Summing the app's card transactions only ever *estimates* a cycle's charge:
--  it can't see the previous-balance carry-over, refunds, or FX adjustments the
--  issuer folds into 今回ご請求金額. When a statement PDF exposes that figure we
--  persist it here, keyed to the settlement date, so the cash-flow projection
--  can show the real debit instead of the estimate.
--
--  This table is deliberately independent of card_statement_imports: an import
--  is hard-deleted once every staging row is reconciled (maybeAutoDeleteImport),
--  but the confirmed bill must survive that cleanup.
-- ============================================================================
create table if not exists card_bills (
  id                     uuid primary key default gen_random_uuid(),
  household_id           uuid not null references households(id) on delete cascade,
  payment_method_id      uuid not null references payment_methods(id) on delete cascade,
  payment_due_date       date not null,            -- settlement day; aligns with the cash-flow bucket
  billed_amount          integer not null,         -- 今回ご請求金額 (actual debit)
  new_charges            integer,                  -- 新規ご利用金額
  payments_adjustments   integer,                  -- お支払い/ご入金・調整金額
  prev_balance           integer,                  -- 前回締切金額
  closing_balance        integer,                  -- 今回締切金額
  closing_period_start   date,
  closing_period_end     date,
  -- Advisory link back to the import that produced this bill. Nulled out when
  -- the import is auto-deleted after reconciliation.
  source_import_id       uuid references card_statement_imports(id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (household_id, payment_method_id, payment_due_date)
);

create index if not exists idx_card_bills_household_due
  on card_bills (household_id, payment_due_date);

-- RLS — same household-scoped pattern as the rest of the data tables.
do $$
begin
  execute 'alter table card_bills enable row level security';
  execute 'drop policy if exists card_bills_household_all on card_bills';
  execute
    'create policy card_bills_household_all on card_bills '
    'for all using (household_id in (select current_household_ids())) '
    'with check (household_id in (select current_household_ids()))';
end $$;
