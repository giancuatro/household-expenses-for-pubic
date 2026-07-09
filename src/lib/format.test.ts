import { describe, it, expect } from "vitest";
import { monthKey, monthDateRange, addMonths, todayIso } from "@/lib/format";

describe("monthKey (20-day cycle)", () => {
  it("day 19 stays in the current calendar month", () => {
    expect(monthKey(new Date(2026, 3, 19))).toBe("2026-04"); // Apr 19
  });
  it("day 20 rolls into the next month", () => {
    expect(monthKey(new Date(2026, 3, 20))).toBe("2026-05"); // Apr 20
  });
  it("December day 20 rolls into next year January", () => {
    expect(monthKey(new Date(2026, 11, 20))).toBe("2027-01");
  });
  it("day 1 is current month", () => {
    expect(monthKey(new Date(2026, 0, 1))).toBe("2026-01");
  });
});

describe("monthDateRange", () => {
  it("spans previous-month 20th to this-month 19th", () => {
    expect(monthDateRange("2026-04")).toEqual({ start: "2026-03-20", end: "2026-04-19" });
  });
  it("handles January (crosses year boundary)", () => {
    expect(monthDateRange("2026-01")).toEqual({ start: "2025-12-20", end: "2026-01-19" });
  });
});

describe("addMonths", () => {
  it("adds within the same year", () => {
    expect(addMonths("2026-04", 2)).toBe("2026-06");
  });
  it("subtracts across the year boundary", () => {
    expect(addMonths("2026-01", -1)).toBe("2025-12");
  });
  it("adds across the year boundary", () => {
    expect(addMonths("2026-11", 3)).toBe("2027-02");
  });
});

describe("todayIso", () => {
  it("returns a JST YYYY-MM-DD string", () => {
    expect(todayIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
