-- Add account_id to investment_transactions so trades can be linked to accounts
ALTER TABLE investment_transactions
  ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES investment_accounts(id) ON DELETE SET NULL;

-- Add unique constraint on (account_id, ticker) for investment_holdings upsert
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_holdings_account_ticker'
  ) THEN
    ALTER TABLE investment_holdings
      ADD CONSTRAINT uq_holdings_account_ticker UNIQUE (account_id, ticker);
  END IF;
END $$;
