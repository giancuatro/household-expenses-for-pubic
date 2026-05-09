import type { PaymentMethodRow } from "@/lib/types";

/**
 * Compute when a credit-card transaction will actually leave the bank account.
 *
 * Cash / transfer methods (or null) settle the same day they happen.
 * Credit cards settle on `payment_day` of the month that is `payment_month_offset`
 * months after the closing month.
 *
 * "末日" handling: closing_day = 31 means "last day of the calendar month".
 * payment_day = 31 means "last day of the payment month".
 *
 * Examples (txDate = 2026-04-15):
 *   - 楽天 (close=31, pay=27, offset=1): closing month = 2026-04 → settles 2026-05-27
 *   - View (close=31, pay=4,  offset=2): closing month = 2026-04 → settles 2026-06-04
 *   - AMEX (close=15, pay=10, offset=1):
 *       txDate (15th) is the closing date → still belongs to 2026-04 cycle → 2026-05-10
 *       txDate 2026-04-16 → next cycle → 2026-05 closes → settles 2026-06-10
 */
export function computeBilling(
  txDate: string, // YYYY-MM-DD
  pm: PaymentMethodRow | null
): { billingMonth: string; settlementDate: string } {
  if (!pm || pm.type !== "credit_card" || pm.closing_day == null || pm.payment_day == null) {
    return { billingMonth: txDate.slice(0, 7), settlementDate: txDate };
  }

  const [yStr, mStr, dStr] = txDate.split("-");
  const txY = Number(yStr);
  const txM = Number(mStr); // 1..12
  const txD = Number(dStr);

  const closingDay = effectiveDayInMonth(pm.closing_day, txY, txM);
  // If the transaction happens AFTER the closing day, the closing month rolls forward.
  const closingMonthDelta = txD <= closingDay ? 0 : 1;
  let closingY = txY;
  let closingM = txM + closingMonthDelta;
  if (closingM > 12) {
    closingM -= 12;
    closingY += 1;
  }

  // Settlement is `payment_month_offset` months after the closing month.
  let settleY = closingY;
  let settleM = closingM + pm.payment_month_offset;
  while (settleM > 12) {
    settleM -= 12;
    settleY += 1;
  }
  const settleD = effectiveDayInMonth(pm.payment_day, settleY, settleM);
  const settlementDate = `${settleY}-${String(settleM).padStart(2, "0")}-${String(settleD).padStart(2, "0")}`;
  const billingMonth = settlementDate.slice(0, 7);
  return { billingMonth, settlementDate };
}

/** Clamp a "day of month" 1..31 to the actual last day of that month (handles 末日 / Feb / leap year). */
function effectiveDayInMonth(day: number, year: number, month: number): number {
  const lastDay = new Date(year, month, 0).getDate();
  return Math.min(day, lastDay);
}

/** Format a closing/payment day as Japanese text — "末日" for 31 when the field is meant to be end-of-month. */
export function formatDayOfMonth(day: number | null): string {
  if (day == null) return "—";
  if (day >= 31) return "末日";
  return `${day}日`;
}

/** True for cash / transfer / null (i.e. no settlement schedule needed). */
export function isImmediateSettlement(pm: PaymentMethodRow | null): boolean {
  return !pm || pm.type !== "credit_card";
}
