-- ============================================================================
--  Phase 6 — Credit-card statement import + reconciliation
--
--  Lets a household import the monthly statement CSV from a card issuer
--  (AMEX, Rakuten, etc.) and reconcile it against the manually-entered
--  transactions in the budget app, surfacing missing entries and duplicates.
--
--  Pipeline:
--    upload CSV → card_statement_imports (1 row, raw_hash dedupes re-uploads)
--                 + staging_card_transactions (N rows, status='unmatched')
--    matcher    → updates staging.status to 'suggested' (≥60) or
--                 'confirmed' (==100, exact same date+amount in transactions)
--    user UI    → flips rows to 'created' (new transaction made),
--                 'confirmed' (linked to existing), or 'ignored'
--
--  The merchant_aliases table is per-household: a small learning store that
--  remembers "this raw-merchant string belongs to this category" so the next
--  import auto-suggests categories without leaking learning across households.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- card_statement_imports
-- ---------------------------------------------------------------------------
create table if not exists card_statement_imports (
  id                   uuid primary key default gen_random_uuid(),
  household_id         uuid not null references households(id) on delete cascade,
  payment_method_id    uuid not null references payment_methods(id) on delete restrict,
  parser               text not null,                -- 'amex' | 'generic'
  source_filename      text,
  source_size_bytes    integer,
  raw_hash             text not null,                -- sha-256 of raw bytes; dedupes re-uploads
  period_start         date,
  period_end           date,
  row_count            integer not null default 0,
  imported_by          uuid references auth.users(id) on delete set null,
  imported_at          timestamptz not null default now(),
  archived_at          timestamptz,
  unique (household_id, raw_hash)
);

create index if not exists idx_csi_household_imported_at
  on card_statement_imports (household_id, imported_at desc);

-- ---------------------------------------------------------------------------
-- staging_card_transactions
-- ---------------------------------------------------------------------------
create table if not exists staging_card_transactions (
  id                       uuid primary key default gen_random_uuid(),
  import_id                uuid not null references card_statement_imports(id) on delete cascade,
  household_id             uuid not null references households(id) on delete cascade,
  -- Raw values straight from the CSV (kept for audit / re-parse).
  raw_date                 text,
  raw_amount               text,
  raw_merchant             text,
  raw_extra                jsonb,
  -- Normalized values used for matching.
  date                     date not null,
  amount                   integer not null,         -- positive yen; refunds = negative
  merchant                 text,
  matched_transaction_id   uuid references transactions(id) on delete set null,
  status                   text not null default 'unmatched'
                           check (status in ('unmatched','suggested','confirmed','ignored','created')),
  match_confidence         smallint check (match_confidence is null or match_confidence between 0 and 100),
  created_at               timestamptz not null default now()
);

create index if not exists idx_sct_import_status on staging_card_transactions (import_id, status);
create index if not exists idx_sct_household_date on staging_card_transactions (household_id, date);

-- Reverse pointer on transactions: when the user accepts a card row to create
-- a transaction (or confirms a match), we stamp the txn so re-running the
-- matcher stays idempotent.
alter table transactions
  add column if not exists statement_row_id uuid
    references staging_card_transactions(id) on delete set null;

create index if not exists idx_txn_statement_row on transactions (statement_row_id);

-- ---------------------------------------------------------------------------
-- merchant_aliases — household-local learning of "merchant → category".
-- ---------------------------------------------------------------------------
create table if not exists merchant_aliases (
  household_id         uuid not null references households(id) on delete cascade,
  merchant_norm        text not null,                -- lower-case, whitespace-collapsed
  category_id          uuid references expense_categories(id) on delete set null,
  category_type        text,                         -- mirrors transactions.category_type
  user_id              uuid references users(id) on delete set null,
  alias_label          text,                         -- canonical display name
  hit_count            integer not null default 1,
  updated_at           timestamptz not null default now(),
  primary key (household_id, merchant_norm)
);

-- ---------------------------------------------------------------------------
-- RLS — same household-scoped pattern as the rest of the data tables.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  tables text[] := array[
    'card_statement_imports',
    'staging_card_transactions',
    'merchant_aliases'
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
