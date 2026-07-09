import { describe, it, expect } from "vitest";
import { buildCashFlowProjection } from "@/lib/cashFlow";
import { txn, creditCard } from "@/lib/testFixtures";
import type { CashBalanceSnapshotRow } from "@/lib/types";

const snap = (as_of_date: string, balance: number): CashBalanceSnapshotRow => ({
  id: "s-" + as_of_date, as_of_date, balance, note: null, created_at: as_of_date + "T00:00:00Z",
});

// All test windows end well before the real "today", so upcoming* stay 0 and
// the projection is fully deterministic.
const END = "2026-04-30";

describe("buildCashFlowProjection", () => {
  it("returns an empty projection with no snapshots", () => {
    const r = buildCashFlowProjection({
      snapshots: [], transactions: [], paymentMethods: [], endDate: END,
    });
    expect(r.anchor).toBeNull();
    expect(r.days).toHaveLength(0);
  });

  it("anchors on the latest snapshot balance", () => {
    const r = buildCashFlowProjection({
      snapshots: [snap("2026-04-01", 100000), snap("2026-03-01", 50000)],
      transactions: [],
      paymentMethods: [],
      endDate: END,
    });
    expect(r.anchor).toEqual({ date: "2026-04-01", balance: 100000 });
    expect(r.days[0].balance).toBe(100000);
  });

  it("a cash expense after the anchor lowers the running balance on its tx date", () => {
    const r = buildCashFlowProjection({
      snapshots: [snap("2026-04-01", 100000)],
      transactions: [txn({ date: "2026-04-05", amount: 3000, category_type: "variable" })],
      paymentMethods: [],
      endDate: END,
    });
    const day = r.days.find((d) => d.date === "2026-04-05")!;
    expect(day.balance).toBe(97000);
  });

  it("a card purchase hits cash on the settlement date, not the purchase date", () => {
    const pm = creditCard({ id: "pm1", closing_day: 15, payment_day: 10, payment_month_offset: 1 });
    const r = buildCashFlowProjection({
      snapshots: [snap("2026-04-01", 100000)],
      transactions: [txn({ date: "2026-04-10", amount: 5000, payment_method_id: "pm1" })],
      paymentMethods: [pm],
      endDate: "2026-05-31",
    });
    // Purchase on 4/10 (before closing 15) → settles 5/10.
    expect(r.days.find((d) => d.date === "2026-04-10")?.netChange ?? 0).toBe(0);
    const settle = r.days.find((d) => d.date === "2026-05-10")!;
    expect(settle.netChange).toBe(-5000);
    expect(settle.balance).toBe(95000);
  });

  it("a settled advance adds a cash inflow on advance_settled_at", () => {
    const r = buildCashFlowProjection({
      snapshots: [snap("2026-04-01", 100000)],
      transactions: [
        txn({
          date: "2026-04-05", amount: 2000, category_type: "variable",
          is_advance_payment: true, advance_settled: true, advance_settled_at: "2026-04-20",
        }),
      ],
      paymentMethods: [],
      endDate: END,
    });
    // Outflow on 4/5, repayment inflow on 4/20 → net zero by end.
    expect(r.days.find((d) => d.date === "2026-04-05")!.netChange).toBe(-2000);
    expect(r.days.find((d) => d.date === "2026-04-20")!.netChange).toBe(2000);
    expect(r.days[r.days.length - 1].balance).toBe(100000);
  });
});
