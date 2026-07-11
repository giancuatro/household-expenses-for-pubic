import { describe, it, expect } from "vitest";
import { fuzzyFindAlias, type AliasRow } from "./merchantAlias";

const alias = (merchant_norm: string, hit_count = 1, category_type = "variable"): AliasRow => ({
  merchant_norm,
  user_id: "u1",
  category_type,
  category_id: null,
  alias_label: merchant_norm,
  hit_count,
});

describe("fuzzyFindAlias", () => {
  const aliases = [
    alias("amazon co jp", 5),
    alias("starbucks", 3),
    alias("seven eleven", 2),
  ];

  it("matches when the query contains a known alias (month-to-month suffix drift)", () => {
    // "amazon co jp ac-4821" ⊇ "amazon co jp"
    expect(fuzzyFindAlias("amazon co jp ac-4821", aliases)?.merchant_norm).toBe("amazon co jp");
  });

  it("matches when a known alias contains the query", () => {
    expect(fuzzyFindAlias("starbucks", aliases)?.merchant_norm).toBe("starbucks");
  });

  it("breaks ties on hit_count", () => {
    const two = [alias("costco kawasaki", 1), alias("costco", 9)];
    expect(fuzzyFindAlias("costco warehouse", two)?.merchant_norm).toBe("costco");
  });

  it("refuses to fuzzy-match short strings (collision-prone)", () => {
    expect(fuzzyFindAlias("aeon", [alias("aeon mall", 4)])).toBeNull();
    expect(fuzzyFindAlias("aeon town chofu", [alias("aeon", 4)])).toBeNull();
  });

  it("returns null when nothing overlaps", () => {
    expect(fuzzyFindAlias("family mart shibuya", aliases)).toBeNull();
  });
});
