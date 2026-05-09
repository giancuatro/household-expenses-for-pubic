-- Rename ORUKAN holdings/transactions to SBI_WORLD.
--
-- Background: the user's "オルカン" position is actually the SBI 雪だるま全世界株式
-- fund (SBI・全世界株式インデックス・ファンド), not eMAXIS Slim. Records were
-- imported under ticker = 'ORUKAN', which made the dashboard fetch the eMAXIS
-- Slim NAV (~36,000) instead of the SBI fund NAV (~33,000).
--
-- This migration:
--   1. Re-tags both transactions and holdings ORUKAN → SBI_WORLD.
--   2. Updates the human-readable `name` to the official long name.
--      The 愛称 ("雪だるま全世界株式") is now resolved client-side via STOCK_LIST.
--
-- Idempotent: running twice is a no-op because the WHERE clause matches nothing
-- after the first run.

update investment_transactions
set ticker = 'SBI_WORLD',
    name   = 'SBI・全世界株式インデックス・ファンド'
where ticker = 'ORUKAN';

update investment_holdings
set ticker = 'SBI_WORLD',
    name   = 'SBI・全世界株式インデックス・ファンド'
where ticker = 'ORUKAN';
