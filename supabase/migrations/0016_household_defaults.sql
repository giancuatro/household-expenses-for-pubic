-- ============================================================================
--  Phase 6.2 — Per-household entry defaults
--
--  Previously the Home tab guessed the default payer (first row in `users`)
--  and the default credit card (hard-coded AMEX Bonvoy match). Both should
--  be user-configurable per household, otherwise the home form gets less
--  useful as the household grows beyond the first member or switches cards.
-- ============================================================================

alter table households
  add column if not exists default_user_id uuid
    references users(id) on delete set null,
  add column if not exists default_payment_method_id uuid
    references payment_methods(id) on delete set null;
