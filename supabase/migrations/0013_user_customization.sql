-- ============================================================================
--  Phase 4 — User customization: per-category color, per-user color,
--                                kind colors, onboarding state.
--
--  All columns/tables are additive. Existing rows continue to work because
--  every customization column is nullable (or has a sensible default), and
--  application code falls back to the built-in palette when the value is null.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Per-row color overrides on existing tables.
-- ---------------------------------------------------------------------------
alter table expense_categories
  add column if not exists color_hex text;

alter table users
  add column if not exists color_hex text;

-- ---------------------------------------------------------------------------
-- 2. Per-household color for transaction "kinds" that are not category rows.
--    income / fixed / loan / special / advance / investment / transfer_in /
--    transfer_out — these come from TxnKind and don't have an expense_categories
--    row, so we keep their colors in a small key/value table per household.
-- ---------------------------------------------------------------------------
create table if not exists kind_colors (
  household_id uuid not null references households(id) on delete cascade,
  kind text not null check (kind in (
    'income','fixed','loan','special','advance','investment',
    'transfer_in','transfer_out'
  )),
  color_hex text not null,
  primary key (household_id, kind)
);

alter table kind_colors enable row level security;

drop policy if exists kind_colors_household_all on kind_colors;
create policy kind_colors_household_all on kind_colors
  for all using (household_id in (select current_household_ids()))
  with check (household_id in (select current_household_ids()));

-- Seed defaults for every existing household. New households are seeded by the
-- /auth/callback bootstrap path.
insert into kind_colors (household_id, kind, color_hex)
select h.id, k.kind, k.color_hex
from households h
cross join (values
  ('income',       '#10b981'),
  ('fixed',        '#6366f1'),
  ('loan',         '#a855f7'),
  ('special',      '#ef4444'),
  ('advance',      '#f59e0b'),
  ('investment',   '#0ea5e9'),
  ('transfer_in',  '#22c55e'),
  ('transfer_out', '#dc2626')
) as k(kind, color_hex)
on conflict (household_id, kind) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Onboarding completion timestamp on households.
-- ---------------------------------------------------------------------------
alter table households
  add column if not exists onboarding_completed_at timestamptz;
