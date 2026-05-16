-- ============================================================================
--  Phase 6.4 — Cardholder tagging on imported statement rows
--
--  Japanese card statements typically include both the primary cardholder's
--  transactions and any family-card (家族カード) transactions in a single PDF
--  / CSV. The household operator wants family-card lines treated as the
--  spouse's personal expense by default — they used to retype these by hand.
--
--  We capture the cardholder type at parse time and persist it here so the
--  reconcile UI can pre-fill the "create transaction" form with the right
--  owner + category kind. 'primary' / 'family' come from explicit markers in
--  the statement; NULL means the parser couldn't tell (treated as primary
--  for UI defaults).
-- ============================================================================

alter table staging_card_transactions
  add column if not exists cardholder text
    check (cardholder is null or cardholder in ('primary', 'family'));

-- Also expose a per-payment-method "family card owner" so the UI knows which
-- user to default family-card rows to (typically the spouse). Optional —
-- when unset, the UI falls back to the first user that isn't the payment
-- method's primary user.
alter table payment_methods
  add column if not exists family_card_user_id uuid
    references users(id) on delete set null;
