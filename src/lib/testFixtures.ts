import type {
  PaymentMethodRow,
  TransactionRow,
  UserRow,
} from "@/lib/types";

/** Build a TransactionRow with sensible defaults; override only what matters. */
export function txn(over: Partial<TransactionRow> = {}): TransactionRow {
  return {
    id: over.id ?? "t-" + Math.random().toString(36).slice(2),
    date: "2026-04-10",
    user_id: "u1",
    amount: 1000,
    category_type: "variable",
    category_id: null,
    subcategory: null,
    note: null,
    is_advance_payment: false,
    advance_settled: false,
    advance_settled_at: null,
    source: "manual",
    source_ref: null,
    payment_method_id: null,
    original_amount: null,
    original_currency: null,
    fx_rate: null,
    fx_status: null,
    trip_id: null,
    created_at: "2026-04-10T00:00:00Z",
    ...over,
  };
}

export function user(id: string, name = id): UserRow {
  return { id, name, created_at: "2026-01-01T00:00:00Z", color_hex: null };
}

export function creditCard(over: Partial<PaymentMethodRow> = {}): PaymentMethodRow {
  return {
    id: over.id ?? "pm-card",
    user_id: null,
    name: "テストカード",
    type: "credit_card",
    closing_day: 15,
    payment_day: 10,
    payment_month_offset: 1,
    bank_account_label: null,
    display_order: 0,
    archived: false,
    family_card_user_id: null,
    ...over,
  };
}
