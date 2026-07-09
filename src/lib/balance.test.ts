import { describe, it, expect } from "vitest";
import { computeBreakdown } from "@/lib/balance";
import { txn, user } from "@/lib/testFixtures";
import type { FixedCostMasterRow } from "@/lib/types";

const users = [user("u1", "夫"), user("u2", "妻")];

describe("computeBreakdown", () => {
  it("splits shared variable + loan equally per user", () => {
    const b = computeBreakdown(
      users,
      [
        txn({ category_type: "variable", amount: 1000 }),
        txn({ category_type: "loan", amount: 500 }),
      ],
      [],
    );
    expect(b.sharedVarTotal).toBe(1000);
    expect(b.loanTotal).toBe(500);
    expect(b.sharedExpenseTotal).toBe(1500);
    expect(b.perUser.get("u1")!.sharedShare).toBe(750);
    expect(b.perUser.get("u2")!.sharedShare).toBe(750);
  });

  it("attributes personal expenses only to the owning user", () => {
    const b = computeBreakdown(
      users,
      [txn({ user_id: "u2", category_type: "personal", amount: 800 })],
      [],
    );
    expect(b.perUser.get("u2")!.personal).toBe(800);
    expect(b.perUser.get("u1")!.personal).toBe(0);
  });

  it("splits special (不明金) equally like shared", () => {
    const b = computeBreakdown(
      users,
      [txn({ category_type: "special", amount: 2000 })],
      [],
    );
    expect(b.specialOut).toBe(2000);
    expect(b.perUser.get("u1")!.specialShare).toBe(1000);
    expect(b.perUser.get("u2")!.specialShare).toBe(1000);
  });

  it("excludes advance payments from every total", () => {
    const b = computeBreakdown(
      users,
      [txn({ category_type: "variable", amount: 1000, is_advance_payment: true })],
      [],
    );
    expect(b.sharedVarTotal).toBe(0);
  });

  it("treats a shared fixed master (user_id null) as shared, not personal", () => {
    const master: FixedCostMasterRow = {
      id: "m1", label: "家賃", name: "家賃", user_id: null, amount: 90000,
      valid_from: "2026-01-01", notes: null, payment_method_id: null,
      payment_day: 27, archived: false,
    };
    const b = computeBreakdown(
      users,
      [txn({ category_type: "fixed", amount: 90000, source: "fixed-auto", source_ref: "fixed:m1:2026-04", user_id: "u1" })],
      [master],
    );
    expect(b.sharedFixedTotal).toBe(90000);
    expect(b.perUser.get("u1")!.personalFixed).toBe(0);
  });

  it("attributes a personal fixed master to its owner", () => {
    const master: FixedCostMasterRow = {
      id: "m2", label: "スマホ", name: "スマホ", user_id: "u2", amount: 5000,
      valid_from: "2026-01-01", notes: null, payment_method_id: null,
      payment_day: 27, archived: false,
    };
    const b = computeBreakdown(
      users,
      [txn({ category_type: "fixed", amount: 5000, source: "fixed-auto", source_ref: "fixed:m2:2026-04", user_id: "u2" })],
      [master],
    );
    expect(b.sharedFixedTotal).toBe(0);
    expect(b.perUser.get("u2")!.personalFixed).toBe(5000);
  });

  it("net = income − expense", () => {
    const b = computeBreakdown(
      users,
      [
        txn({ user_id: "u1", category_type: "income", amount: 300000 }),
        txn({ category_type: "variable", amount: 1000 }),
      ],
      [],
    );
    const u1 = b.perUser.get("u1")!;
    expect(u1.income).toBe(300000);
    expect(u1.net).toBe(300000 - 500);
  });
});
