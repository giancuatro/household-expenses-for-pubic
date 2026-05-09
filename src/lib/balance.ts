import type { FixedCostMasterRow, TransactionRow, UserRow } from "./types";

export type UserBreakdown = {
  income: number;
  sharedShare: number;       // (sharedExpenseTotal) / N
  specialShare: number;      // specialOut / N
  personal: number;          // personal-category expenses for this user
  personalFixed: number;     // personal fixed costs (master.user_id === u.id) for this user
  expense: number;           // sum of the four shares above
  net: number;               // income - expense
};

export type AggregateBreakdown = {
  sharedVarTotal: number;
  loanTotal: number;
  sharedFixedTotal: number;     // shared (master.user_id === null) fixed costs only
  sharedExpenseTotal: number;   // sharedVar + loan + sharedFixed
  specialOut: number;
  perUser: Map<string, UserBreakdown>;
};

/**
 * Compute breakdown of monthly transactions across users with the apportionment
 * convention: shared expenses (variable + loan + shared fixed) and special
 * expenses are split equally per active user; personal expenses and personal
 * fixed costs are attributed to the owning user.
 *
 * Note on shared fixed costs: applyFixedCostsForMonth attributes shared masters
 * (master.user_id === null) to a fallback user via fixed-auto inserts. We
 * identify these by source/source_ref + master ownership map and exclude them
 * from per-user personal-fixed totals so they don't get double counted.
 */
export function computeBreakdown(
  users: UserRow[],
  transactions: TransactionRow[],
  fixedCostMasters: FixedCostMasterRow[]
): AggregateBreakdown {
  const personalMasterIds = new Set(
    fixedCostMasters.filter((m) => m.user_id !== null).map((m) => m.id)
  );

  const nonAdvance = transactions.filter((t) => !t.is_advance_payment);

  const isPersonalFixed = (t: TransactionRow): boolean => {
    if (t.category_type !== "fixed") return false;
    if (t.source === "fixed-auto" && t.source_ref) {
      // source_ref format: `fixed:<masterId>:<YYYY-MM>`
      const masterId = t.source_ref.split(":")[1];
      return masterId ? personalMasterIds.has(masterId) : false;
    }
    // Manual entries (no source_ref): treat as personal if attributed to a user
    return Boolean(t.user_id);
  };

  const sum = (arr: TransactionRow[]) => arr.reduce((a, t) => a + t.amount, 0);

  const sharedVarTotal = sum(nonAdvance.filter((t) => t.category_type === "variable"));
  const loanTotal = sum(nonAdvance.filter((t) => t.category_type === "loan"));
  const sharedFixedTotal = sum(
    nonAdvance.filter((t) => t.category_type === "fixed" && !isPersonalFixed(t))
  );
  const sharedExpenseTotal = sharedVarTotal + loanTotal + sharedFixedTotal;
  const specialOut = sum(nonAdvance.filter((t) => t.category_type === "special"));

  const N = Math.max(1, users.length);
  const perUser = new Map<string, UserBreakdown>();

  for (const u of users) {
    const income = sum(
      nonAdvance.filter((t) => t.user_id === u.id && t.category_type === "income")
    );
    const personal = sum(
      nonAdvance.filter((t) => t.user_id === u.id && t.category_type === "personal")
    );
    const personalFixed = sum(
      nonAdvance.filter((t) => t.user_id === u.id && isPersonalFixed(t))
    );
    const sharedShare = sharedExpenseTotal / N;
    const specialShare = specialOut / N;
    const expense = sharedShare + specialShare + personal + personalFixed;
    perUser.set(u.id, {
      income,
      sharedShare,
      specialShare,
      personal,
      personalFixed,
      expense,
      net: income - expense,
    });
  }

  return {
    sharedVarTotal,
    loanTotal,
    sharedFixedTotal,
    sharedExpenseTotal,
    specialOut,
    perUser,
  };
}
