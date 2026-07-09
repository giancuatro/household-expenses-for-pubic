import { describe, it, expect } from "vitest";
import { computeBilling } from "@/lib/paymentSchedule";
import { creditCard } from "@/lib/testFixtures";

describe("computeBilling", () => {
  it("cash / null settles the same day", () => {
    expect(computeBilling("2026-04-15", null).settlementDate).toBe("2026-04-15");
    expect(
      computeBilling("2026-04-15", creditCard({ type: "cash", closing_day: null, payment_day: null })).settlementDate,
    ).toBe("2026-04-15");
  });

  it("AMEX close=15 pay=10 offset=1: on the closing day still belongs to that cycle", () => {
    const pm = creditCard({ closing_day: 15, payment_day: 10, payment_month_offset: 1 });
    expect(computeBilling("2026-04-15", pm).settlementDate).toBe("2026-05-10");
  });

  it("AMEX: one day after closing rolls to the next cycle", () => {
    const pm = creditCard({ closing_day: 15, payment_day: 10, payment_month_offset: 1 });
    expect(computeBilling("2026-04-16", pm).settlementDate).toBe("2026-06-10");
  });

  it("末日 closing (31) + offset 2", () => {
    const pm = creditCard({ closing_day: 31, payment_day: 4, payment_month_offset: 2 });
    // April cycle closes end of April → settles June 4
    expect(computeBilling("2026-04-15", pm).settlementDate).toBe("2026-06-04");
  });

  it("payment_day 31 clamps to the last day of the settlement month (Feb non-leap)", () => {
    const pm = creditCard({ closing_day: 31, payment_day: 31, payment_month_offset: 1 });
    // Jan 2027 cycle closes end of Jan → settles Feb, clamped to 28 (2027 not leap)
    expect(computeBilling("2027-01-10", pm).settlementDate).toBe("2027-02-28");
  });

  it("payment_day 31 clamps to Feb 29 in a leap year", () => {
    const pm = creditCard({ closing_day: 31, payment_day: 31, payment_month_offset: 1 });
    // Jan 2028 cycle → settles Feb 2028 (leap) → 29
    expect(computeBilling("2028-01-10", pm).settlementDate).toBe("2028-02-29");
  });

  it("offset wrapping across the year boundary", () => {
    const pm = creditCard({ closing_day: 31, payment_day: 27, payment_month_offset: 2 });
    // Nov 2026 cycle → +2 months → Jan 2027
    expect(computeBilling("2026-11-15", pm).settlementDate).toBe("2027-01-27");
  });
});
