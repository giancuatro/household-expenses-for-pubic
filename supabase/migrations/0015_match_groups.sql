-- ============================================================================
--  Phase 6.1 — Group matches for reconcile
--
--  Real-world case the matcher missed:
--
--    User enters "Amazon ¥5,000" as a single transaction (one click).
--    The credit-card statement breaks the same purchase into multiple
--    line items: ¥2,000 + ¥1,500 + ¥1,500 = ¥5,000.
--
--  The 1:1 matcher can't see this — no card row matches ¥5,000 alone, and
--  no transaction matches ¥2,000 / ¥1,500 alone, so all five rows fall
--  through to "unmatched".
--
--  match_group_id lets multiple staging rows share a single matched
--  transaction. The server-action layer treats every group member as
--  one unit: accept one → all become 'confirmed'; reject one → all return
--  to 'unmatched'.
-- ============================================================================

alter table staging_card_transactions
  add column if not exists match_group_id uuid;

create index if not exists idx_sct_match_group
  on staging_card_transactions (match_group_id)
  where match_group_id is not null;
