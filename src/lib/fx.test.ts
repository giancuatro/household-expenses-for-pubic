import { describe, it, expect } from "vitest";
import { computeFxAmount } from "@/lib/fx";

describe("computeFxAmount", () => {
  it("rounds to the nearest yen", () => {
    expect(computeFxAmount(10, 150.4)).toBe(1504);
    expect(computeFxAmount(10, 150.46)).toBe(1505);
  });
  it("clamps sub-yen results to at least 1", () => {
    expect(computeFxAmount(0.001, 1)).toBe(1);
  });
  it("handles typical USD amount", () => {
    expect(computeFxAmount(23.5, 156.2)).toBe(3671); // 3670.7 → 3671
  });
});
