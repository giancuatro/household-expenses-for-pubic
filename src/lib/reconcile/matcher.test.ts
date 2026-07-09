import { describe, it, expect } from "vitest";
import {
  scorePair,
  reconcile,
  statusFromConfidence,
  findGroupMatches,
  type CardRow,
  type CandidateTxn,
} from "@/lib/reconcile/matcher";

const card = (over: Partial<CardRow> = {}): CardRow => ({
  id: "c1", date: "2026-04-10", amount: 1000, merchant: null, ...over,
});
const cand = (over: Partial<CandidateTxn> = {}): CandidateTxn => ({
  id: "t1", date: "2026-04-10", amount: 1000, note: null, ...over,
});

describe("scorePair", () => {
  it("same date + same amount is the only 100 (auto-confirm)", () => {
    expect(scorePair(card(), cand())).toBe(100);
  });

  it("amount mismatch is not a candidate", () => {
    expect(scorePair(card({ amount: 1000 }), cand({ amount: 1001 }))).toBe(0);
  });

  it("a ±3 day drift never reaches 100 even with a merchant match", () => {
    const s = scorePair(
      card({ date: "2026-04-13", merchant: "AMAZON" }),
      cand({ date: "2026-04-10", note: "AMAZON" }),
    );
    expect(s).toBeLessThanOrEqual(95);
    expect(s).toBeGreaterThanOrEqual(60);
  });

  it("beyond 7 days is not a candidate", () => {
    expect(scorePair(card({ date: "2026-04-20" }), cand({ date: "2026-04-10" }))).toBe(0);
  });
});

describe("statusFromConfidence", () => {
  it("only 100 confirms", () => {
    expect(statusFromConfidence(100)).toBe("confirmed");
    expect(statusFromConfidence(95)).toBe("suggested");
    expect(statusFromConfidence(60)).toBe("suggested");
    expect(statusFromConfidence(59)).toBe("unmatched");
  });
});

describe("reconcile", () => {
  it("assigns each txn to at most one card row (greedy)", () => {
    const cards = [card({ id: "c1" }), card({ id: "c2" })];
    const txns = [cand({ id: "t1" })];
    const verdicts = reconcile(cards, txns);
    const matched = verdicts.filter((v) => v.matchedTxnId === "t1");
    expect(matched).toHaveLength(1);
    // the unmatched card row still gets a verdict
    expect(verdicts).toHaveLength(2);
  });

  it("unmatched card rows get a null verdict", () => {
    const verdicts = reconcile([card({ amount: 999 })], [cand({ amount: 1000 })]);
    expect(verdicts[0].matchedTxnId).toBeNull();
    expect(verdicts[0].confidence).toBe(0);
  });
});

describe("findGroupMatches", () => {
  it("groups rows that sum to a transaction amount, capped ≤85", () => {
    const cards = [
      card({ id: "c1", amount: 600, date: "2026-04-10" }),
      card({ id: "c2", amount: 400, date: "2026-04-10" }),
    ];
    const txns = [cand({ id: "t1", amount: 1000, date: "2026-04-10" })];
    const groups = findGroupMatches(cards, txns);
    expect(groups).toHaveLength(1);
    expect(groups[0].cardRowIds.sort()).toEqual(["c1", "c2"]);
    expect(groups[0].matchedTxnId).toBe("t1");
    expect(groups[0].confidence).toBeLessThanOrEqual(85);
  });
});
