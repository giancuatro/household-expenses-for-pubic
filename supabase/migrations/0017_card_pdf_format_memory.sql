-- ============================================================================
--  Phase 6.3 — Per-household PDF format memory
--
--  The PDF parser ships several extraction strategies (compact / split-col
--  / etc.). The first time a household imports a particular card's PDF we
--  trial every strategy and pick the one that returned the most rows.
--  That's cheap (microseconds), but writing down which strategy won lets
--  us:
--
--    1. Show the user "学習済みフォーマット" feedback so they know the
--       system has seen this card before.
--    2. Skip the trial on subsequent imports — useful when we eventually
--       add more / costlier strategies (LLM extraction, layout-aware
--       parsing, etc.) where re-trying every time would be wasteful.
--    3. Hold the seam for a future "teach me this format" wizard. A
--       user-defined extraction config can land in the same row's
--       `layout_override` column without needing more schema.
--
--  Fingerprint: a stable hash of the normalized PDF header text. The
--  cardholder name and card number appear there, so the fingerprint is
--  unique per (card, holder) — different card brands produce different
--  fingerprints; the same card across months stays consistent.
-- ============================================================================

create table if not exists card_pdf_format_memory (
  household_id     uuid not null references households(id) on delete cascade,
  fingerprint      text not null,
  parser_strategy  text not null,          -- 'compact' | 'split-col' | future ids
  card_label       text,                   -- optional human-readable name set by the user
  hit_count        integer not null default 1,
  first_seen_at    timestamptz not null default now(),
  last_used_at     timestamptz not null default now(),
  layout_override  jsonb,                  -- reserved for future learning wizard
  primary key (household_id, fingerprint)
);

alter table card_pdf_format_memory enable row level security;

drop policy if exists card_pdf_format_memory_household_all on card_pdf_format_memory;
create policy card_pdf_format_memory_household_all on card_pdf_format_memory
  for all using (household_id in (select current_household_ids()))
       with check (household_id in (select current_household_ids()));
