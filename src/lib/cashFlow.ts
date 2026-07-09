import type {
  CashBalanceSnapshotRow,
  FixedCostMasterRow,
  PaymentMethodRow,
  TransactionRow,
} from "@/lib/types";
import { computeBilling } from "@/lib/paymentSchedule";
import { addMonths, firstOfMonth, monthDateRange, monthKey, todayIso } from "@/lib/format";

/**
 * One day on the cash-flow timeline.
 *
 * `balance` = running balance at end-of-day after all `events` apply.
 * `events` are aggregated per (settlement-date × source) — so on 5/10 you see
 *   one "AMEX Bonvoy Premium 引落 -¥35,258" row, not eight individual purchases.
 */
export type CashFlowDay = {
  date: string; // YYYY-MM-DD
  balance: number;
  /** Net change on this day (sum of events). */
  netChange: number;
  events: CashFlowEvent[];
};

export type CashFlowEvent = {
  date: string;
  amount: number; // signed (negative = outflow)
  /** "AMEX Bonvoy Premium 引落" / "現金収入" / "振込支出" 等。 */
  label: string;
  /** How many underlying transactions were aggregated. */
  count: number;
  kind: "card_settle" | "cash_in" | "cash_out" | "transfer_in" | "transfer_out" | "snapshot";
};

function addDays(iso: string, delta: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d + delta);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

function listDaysInclusive(from: string, to: string): string[] {
  const out: string[] = [];
  let cur = from;
  while (cur <= to) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

/**
 * Decide on which date a transaction actually hits the cash wallet.
 *
 *   - category_type === "income"    → always tx date. Salaries land in the
 *     bank account on the day they're recorded. Even if a card method is
 *     attached by mistake (or as a card refund), settle-on-tx-date is the
 *     conservative choice — credits to a card just lower the next bill,
 *     and we'd rather under-credit than wrongly inflate a future day.
 *   - cash / transfer / no-method   → tx date.
 *   - credit card (anything else)   → card settlement date.
 */
function settlementDateOf(t: TransactionRow, pm: PaymentMethodRow | null): string {
  if (t.category_type === "income") return t.date;
  if (!pm || pm.type !== "credit_card") return t.date;
  return computeBilling(t.date, pm).settlementDate;
}

function signedAmount(t: TransactionRow): number {
  if (t.category_type === "income") return t.amount;
  if (t.category_type === "transfer_in") return t.amount;
  if (t.category_type === "transfer_out") return -t.amount;
  return -t.amount; // variable / fixed / loan / personal / special / investment
}

/** Stable bucket key per (effective date × source) so we can aggregate. */
function bucketKey(t: TransactionRow, pm: PaymentMethodRow | null, effDate: string): string {
  // Income (incl. stock-sale auto-income from investment.ts) is always cash
  // on the transaction date — never bucketed under a card, even if the row
  // happens to carry a card payment_method_id.
  if (t.category_type === "income") return `${effDate}::income`;
  if (t.category_type === "transfer_in") return `${effDate}::transfer_in`;
  if (t.category_type === "transfer_out") return `${effDate}::transfer_out`;
  if (pm && pm.type === "credit_card") return `${effDate}::card::${pm.id}`;
  if (pm && pm.type === "transfer") return `${effDate}::transfer_out_pm`;
  return `${effDate}::cash_out`;
}

function bucketLabel(
  t: TransactionRow,
  pm: PaymentMethodRow | null,
): { label: string; kind: CashFlowEvent["kind"] } {
  if (t.category_type === "income") return { label: "収入", kind: "cash_in" };
  if (t.category_type === "transfer_in") return { label: "振替入金", kind: "transfer_in" };
  if (t.category_type === "transfer_out") return { label: "振替出金", kind: "transfer_out" };
  if (pm && pm.type === "credit_card") {
    return { label: `${pm.name} 引落`, kind: "card_settle" };
  }
  if (pm && pm.type === "transfer") return { label: "振込支出", kind: "transfer_out" };
  return { label: "現金支出", kind: "cash_out" };
}

/**
 * Pick the cash-out date for a fixed cost in a given 20-day cycle.
 * Mirror of fixedCosts.ts#txDateForCycle (kept inlined here to avoid a server
 * import). day<20 → ym month, day>=20 → previous calendar month, so the date
 * stays inside the cycle window.
 */
function txDateForCycle(ym: string, paymentDay: number | null, cycleStart: string): string {
  if (paymentDay == null) return cycleStart;
  const [y, m] = ym.split("-").map(Number);
  let calY = y;
  let calM = paymentDay < 20 ? m : m - 1;
  if (calM < 1) {
    calM += 12;
    calY -= 1;
  }
  const lastDay = new Date(calY, calM, 0).getDate();
  const day = Math.min(paymentDay, lastDay);
  return `${calY}-${String(calM).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Synthesize fixed-cost transactions forward from masters for cycles whose
 * auto-generated row doesn't yet exist (typical: future cycles haven't been
 * triggered by the cycle-rollover). This guarantees the cash-flow chart
 * always reflects the master's CURRENT settings (payment_day, amount,
 * payment_method) without waiting for the next month-rollover.
 *
 * Past tx and existing source_refs are never duplicated.
 */
function projectFixedCostsForward(
  masters: FixedCostMasterRow[],
  transactions: TransactionRow[],
  fromDate: string,
  endDate: string,
  fallbackUserId: string,
): TransactionRow[] {
  const existingRefs = new Set(
    transactions
      .filter((t) => t.source === "fixed-auto" && t.source_ref)
      .map((t) => t.source_ref as string),
  );
  const synthetic: TransactionRow[] = [];
  const currentYm = monthKey();
  // Look up to 4 cycles forward — enough to cover a 60-day projection regardless
  // of where today sits in the cycle.
  for (const m of masters) {
    if (m.archived) continue;
    for (let i = 0; i < 4; i++) {
      const ym = addMonths(currentYm, i);
      if (m.valid_from > firstOfMonth(ym)) continue;
      const ref = `fixed:${m.id}:${ym}`;
      if (existingRefs.has(ref)) continue;
      const { start: cycleStart } = monthDateRange(ym);
      const date = txDateForCycle(ym, m.payment_day, cycleStart);
      if (date < fromDate || date > endDate) continue;
      synthetic.push({
        id: `synthetic:${m.id}:${ym}`,
        date,
        user_id: m.user_id ?? fallbackUserId,
        amount: m.amount,
        category_type: m.label === "ローン" ? "loan" : "fixed",
        category_id: null,
        subcategory: m.name,
        note: m.label,
        is_advance_payment: false,
        advance_settled: false,
        advance_settled_at: null,
        source: "fixed-auto",
        source_ref: ref,
        payment_method_id: m.payment_method_id,
        original_amount: null,
        original_currency: null,
        fx_rate: null,
        fx_status: null,
        trip_id: null,
        created_at: new Date().toISOString(),
      });
    }
  }
  return synthetic;
}

export function buildCashFlowProjection({
  snapshots,
  transactions,
  paymentMethods,
  fixedCostMasters = [],
  fromDate,
  endDate,
}: {
  snapshots: CashBalanceSnapshotRow[];
  transactions: TransactionRow[];
  paymentMethods: PaymentMethodRow[];
  /** Used to forward-project unrealized fixed-cost cash-outs into the window. */
  fixedCostMasters?: FixedCostMasterRow[];
  fromDate?: string;
  endDate: string;
}): {
  anchor: { date: string; balance: number } | null;
  days: CashFlowDay[];
  upcomingOutflow: number;
  upcomingInflow: number;
  firstShortfallDate: string | null;
} {
  if (snapshots.length === 0) {
    return {
      anchor: null,
      days: [],
      upcomingOutflow: 0,
      upcomingInflow: 0,
      firstShortfallDate: null,
    };
  }

  const sorted = [...snapshots].sort((a, b) => b.as_of_date.localeCompare(a.as_of_date));
  const anchor = sorted[0];

  const pmById = new Map(paymentMethods.map((m) => [m.id, m]));

  // Forward-project fixed costs whose auto-tx hasn't been generated yet, so
  // edits to a master's payment_day / amount / payment_method are reflected
  // immediately in the chart even before the next cycle-rollover.
  const fallbackUserId = transactions[0]?.user_id ?? "";
  const synthetic = projectFixedCostsForward(
    fixedCostMasters,
    transactions,
    anchor.as_of_date,
    endDate,
    fallbackUserId,
  );
  const allTx = synthetic.length > 0 ? [...transactions, ...synthetic] : transactions;

  // Aggregate transactions into (date × source) buckets.
  const bucketsByDate = new Map<string, Map<string, CashFlowEvent>>();
  for (const t of allTx) {
    const pm = t.payment_method_id ? pmById.get(t.payment_method_id) ?? null : null;
    const effDate = settlementDateOf(t, pm);
    if (effDate <= anchor.as_of_date) continue;
    if (effDate > endDate) continue;
    const key = bucketKey(t, pm, effDate);
    const meta = bucketLabel(t, pm);
    let dayMap = bucketsByDate.get(effDate);
    if (!dayMap) {
      dayMap = new Map();
      bucketsByDate.set(effDate, dayMap);
    }
    const existing = dayMap.get(key);
    if (existing) {
      existing.amount += signedAmount(t);
      existing.count += 1;
    } else {
      dayMap.set(key, {
        date: effDate,
        amount: signedAmount(t),
        label: meta.label,
        count: 1,
        kind: meta.kind,
      });
    }
  }

  // Settled-advance inflows: when an advance was paid back, add a +amount cash
  // inflow on advance_settled_at. The original card-side outflow already lives
  // on the settlement date (above), so the net effect across both dates equals
  // the family's actual cash impact (=0 for the advance portion).
  for (const t of allTx) {
    if (!t.is_advance_payment || !t.advance_settled || !t.advance_settled_at) continue;
    const day = t.advance_settled_at;
    if (day <= anchor.as_of_date) continue;
    if (day > endDate) continue;
    const key = `${day}::advance_settle`;
    let dayMap = bucketsByDate.get(day);
    if (!dayMap) {
      dayMap = new Map();
      bucketsByDate.set(day, dayMap);
    }
    const existing = dayMap.get(key);
    if (existing) {
      existing.amount += t.amount;
      existing.count += 1;
    } else {
      dayMap.set(key, {
        date: day,
        amount: t.amount, // positive = cash inflow
        label: "立替精算入金",
        count: 1,
        kind: "cash_in",
      });
    }
  }

  // Simulate from the anchor date, not from `fromDate`. Events between the
  // anchor and the visible window (e.g. a 5/10 引落 when the snapshot is 5/1
  // and `fromDate` is 5/13) must apply to `running` — otherwise today's
  // predicted balance silently inherits the stale anchor balance.
  // `fromDate` only controls the slice of `days` returned for display.
  const displayStart =
    fromDate && fromDate >= anchor.as_of_date ? fromDate : anchor.as_of_date;
  const days: CashFlowDay[] = [];
  let running = anchor.balance;
  let firstShortfallDate: string | null = null;
  let upcomingOutflow = 0;
  let upcomingInflow = 0;
  const todayKey = todayIso();

  for (const day of listDaysInclusive(anchor.as_of_date, endDate)) {
    let evs: CashFlowEvent[];
    let net = 0;
    if (day === anchor.as_of_date) {
      const noteSuffix = anchor.note ? ` (${anchor.note})` : "";
      evs = [{
        date: day,
        amount: 0,
        label: `スナップショット${noteSuffix}`,
        count: 1,
        kind: "snapshot",
      }];
    } else {
      const dayMap = bucketsByDate.get(day);
      evs = dayMap
        ? [...dayMap.values()].sort((a, b) => a.amount - b.amount) // outflows first
        : [];
      net = evs.reduce((s, e) => s + e.amount, 0);
      running += net;
    }
    if (day >= displayStart) {
      days.push({ date: day, balance: running, netChange: net, events: evs });
      if (firstShortfallDate === null && running < 0) firstShortfallDate = day;
    }
    if (day >= todayKey) {
      for (const e of evs) {
        if (e.amount < 0) upcomingOutflow += -e.amount;
        else if (e.amount > 0) upcomingInflow += e.amount;
      }
    }
  }

  return {
    anchor: { date: anchor.as_of_date, balance: anchor.balance },
    days,
    upcomingOutflow,
    upcomingInflow,
    firstShortfallDate,
  };
}
