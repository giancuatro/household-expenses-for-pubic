export type CategoryKind = "shared" | "personal";

export type TxnKind =
  | "income"
  | "fixed"
  | "loan"
  | "variable"
  | "personal"
  | "transfer_in"
  | "transfer_out"
  | "special"
  | "investment";

export interface UserRow {
  id: string;
  name: string;
  created_at: string;
}

export interface CategoryRow {
  id: string;
  name: string;
  type: CategoryKind;
  budget_amount: number;
  is_active: boolean;
  sort_order: number;
}

export interface FixedCostMasterRow {
  id: string;
  label: string;
  name: string;
  user_id: string | null;
  amount: number;
  valid_from: string; // YYYY-MM-DD (always day 01)
  notes: string | null;
  /** Phase 4: payment method used to settle this fixed cost. NULL = unspecified (treated as 現金). */
  payment_method_id: string | null;
  /** Phase 4.1: day-of-month the cost actually leaves the bank (1..31). NULL = legacy (cycle-start). */
  payment_day: number | null;
}

export interface CashBalanceSnapshotRow {
  id: string;
  as_of_date: string; // YYYY-MM-DD
  balance: number;
  note: string | null;
  created_at: string;
}

export interface TransactionRow {
  id: string;
  date: string;
  user_id: string;
  amount: number;
  category_type: TxnKind;
  category_id: string | null;
  subcategory: string | null;
  note: string | null;
  is_advance_payment: boolean;
  advance_settled: boolean;
  /** YYYY-MM-DD — when the advance was actually paid back. Drives the CF inflow event. */
  advance_settled_at: string | null;
  source: string | null;
  source_ref: string | null;
  /** Phase 3+: which payment method funded this transaction. NULL = legacy/未分類 (treated as 現金). */
  payment_method_id: string | null;
  created_at: string;
}

export type PaymentMethodType = "cash" | "transfer" | "credit_card";

export interface PaymentMethodRow {
  id: string;
  user_id: string | null;
  name: string;
  type: PaymentMethodType;
  /** Closing day of month (1..31). 31 means 末日. Null for cash/transfer. */
  closing_day: number | null;
  /** Bank withdrawal day of month (1..31). Null for cash/transfer. */
  payment_day: number | null;
  /** Months between the closing date and the bank withdrawal (1 = next month, 2 = month-after-next). */
  payment_month_offset: number;
  bank_account_label: string | null;
  display_order: number;
  archived: boolean;
}

export interface InvestmentAccountRow {
  id: string;
  user_id: string;
  provider: string;
  account_name: string;
  is_active: boolean;
}

export interface InvestmentHoldingRow {
  id: string;
  account_id: string;
  fetched_at: string;
  ticker: string;
  name: string | null;
  quantity: number;
  avg_cost_usd: number;
  current_price_usd: number;
  exchange_rate: number;
  total_value_jpy: number;
  unrealized_gain_jpy: number;
}

export interface InvestmentTransactionRow {
  id: string;
  date: string;
  user_id: string;
  account_id: string | null;
  ticker: string;
  name: string | null;
  action: "buy" | "sell";
  quantity: number;
  price_usd: number;
  exchange_rate: number;
  amount_jpy: number;
  linked_transaction_id: string | null;
  note: string | null;
}
