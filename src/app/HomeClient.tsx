"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { Plus, SlidersHorizontal } from "lucide-react";
import { toast } from "@/lib/toast";
import type {
  CashBalanceSnapshotRow,
  CategoryRow,
  FixedCostMasterRow,
  TransactionRow,
  UserRow,
  TxnKind,
  PaymentMethodRow,
} from "@/lib/types";
import { yen, formatJaDate, todayIso, formatJaMonth, addMonths, monthKey } from "@/lib/format";
import { buildCategoryColorMap } from "@/lib/categoryColors";
import { buildUserColorMap, userColor, type UserColor } from "@/lib/userColors";
import { computeBreakdown } from "@/lib/balance";
import { buildCashFlowProjection } from "@/lib/cashFlow";
import {
  upsertTransaction,
  deleteTransaction,
  toggleAdvanceSettled,
  getTransactionsForMonth,
  bulkUpdateTransactions,
  bulkDeleteTransactions,
  createSplitTransaction,
  listUnsettledAdvances,
} from "./actions/transactions";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetBody,
  SheetDescription,
  SheetFooter,
  SheetClose,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";

type Props = {
  users: UserRow[];
  categories: CategoryRow[];
  transactions: TransactionRow[];
  prevTransactions: TransactionRow[];
  allTransactions: TransactionRow[];
  fixedCostMasters: FixedCostMasterRow[];
  paymentMethods: PaymentMethodRow[];
  cashSnapshots: CashBalanceSnapshotRow[];
  currentMonth: string;
};

/** Next YYYY-MM-DD on or after `from` whose day-of-month equals `day`. */
function nextDayOfMonth(from: string, day: number): string {
  const [y, m, d] = from.split("-").map(Number);
  let calY = y;
  let calM = m;
  if (d > day) {
    calM += 1;
    if (calM > 12) {
      calM = 1;
      calY += 1;
    }
  }
  const lastDay = new Date(calY, calM, 0).getDate();
  const dd = Math.min(day, lastDay);
  return `${calY}-${String(calM).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

export default function HomeClient({
  users,
  categories,
  transactions,
  prevTransactions,
  allTransactions,
  fixedCostMasters,
  paymentMethods,
  cashSnapshots,
  currentMonth,
}: Props) {
  const router = useRouter();

  // Auto-refresh if the 20-day cycle has rolled over to a new month
  useEffect(() => {
    const expected = monthKey(new Date());
    if (expected !== currentMonth) router.refresh();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [userId, setUserId] = useState<string | null>(users[0]?.id ?? null);
  const [amount, setAmount] = useState<string>("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [txnKind, setTxnKind] = useState<TxnKind>("variable");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(todayIso());
  const [isAdvance, setIsAdvance] = useState(false);
  /* ----- Split (group bill) mode ----- */
  const [splitMode, setSplitMode] = useState(false);
  const [splitOurAmount, setSplitOurAmount] = useState<string>("");
  // splitMode の「総額」は通常の amount フィールドを再利用する（カード請求額 = 家計分 + 立替分）。
  const defaultPaymentMethodId = useMemo(() => {
    const isAmex = (m: PaymentMethodRow) => /AMEX.*Bonvoy.*Premium/i.test(m.name);
    const own = paymentMethods.find((m) => isAmex(m) && m.user_id === users[0]?.id);
    if (own) return own.id;
    const any = paymentMethods.find(isAmex);
    return any?.id ?? null;
  }, [paymentMethods, users]);
  const [paymentMethodId, setPaymentMethodId] = useState<string | null>(defaultPaymentMethodId);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [entryOpen, setEntryOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [advancesOpen, setAdvancesOpen] = useState(false);
  const [unsettled, setUnsettled] = useState<TransactionRow[] | null>(null);
  const [loadingUnsettled, setLoadingUnsettled] = useState(false);
  async function openAdvancesModal() {
    setAdvancesOpen(true);
    setLoadingUnsettled(true);
    try {
      const list = await listUnsettledAdvances();
      setUnsettled(list);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingUnsettled(false);
    }
  }
  async function settleAdvance(id: string, settledAt: string) {
    try {
      await toggleAdvanceSettled(id, true, settledAt);
      setUnsettled((prev) => prev?.filter((t) => t.id !== id) ?? null);
      toast.success("精算済みにしました");
      router.refresh();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  /* ----- Edit / selection state ----- */
  const [editingTxn, setEditingTxn] = useState<TransactionRow | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const toggleSelected = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  function exitSelection() {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }

  /* ----- Month navigator state ----- */
  const [viewMonth, setViewMonth] = useState(currentMonth);
  const [viewTransactions, setViewTransactions] = useState<TransactionRow[]>(transactions);
  const [loadingTxns, setLoadingTxns] = useState(false);

  /* ----- Sort state ----- */
  type SortKey = "date" | "amount_desc" | "amount_asc";
  const [sortKey, setSortKey] = useState<SortKey>("date");

  /* ----- Multi-select filter: individual categories + non-variable kinds ----- */
  // Filter keys: `cat:<id>` for shared variable categories (食費 etc.), `kind:<type>` for others.
  const OTHER_KIND_OPTIONS: { value: TxnKind; label: string }[] = [
    { value: "income", label: "収入" },
    { value: "personal", label: "個人" },
    { value: "fixed", label: "固定費" },
    { value: "loan", label: "ローン" },
    { value: "special", label: "特別" },
    { value: "investment", label: "投資" },
    { value: "transfer_in", label: "振込(入)" },
    { value: "transfer_out", label: "振込(出)" },
  ];

  // When server re-validates (e.g. after pull-to-refresh or month roll-over),
  // keep the current-month list in sync and snap viewMonth to the new currentMonth.
  useEffect(() => {
    if (viewMonth === currentMonth) {
      setViewTransactions(transactions);
    } else if (!monthOptions.includes(viewMonth)) {
      // The viewed month is no longer in the options (shouldn't happen), reset
      setViewMonth(currentMonth);
      setViewTransactions(transactions);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactions, currentMonth]);

  // Generate month options: current month + 23 months back
  const monthOptions = useMemo(() => {
    const opts: string[] = [];
    for (let i = 0; i <= 23; i++) opts.push(addMonths(currentMonth, -i));
    return opts; // most recent first
  }, [currentMonth]);

  async function handleViewMonthChange(newMonth: string) {
    setViewMonth(newMonth);
    if (newMonth === currentMonth) {
      setViewTransactions(transactions);
      return;
    }
    setLoadingTxns(true);
    try {
      const txns = await getTransactionsForMonth(newMonth);
      setViewTransactions(txns);
    } catch {
      // keep previous list on error
    } finally {
      setLoadingTxns(false);
    }
  }

  const viewMonthIdx = monthOptions.indexOf(viewMonth);

  /* ----- Category helpers ----- */
  const userMap = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
  const catMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const colorMap = useMemo(() => buildCategoryColorMap(categories), [categories]);
  const pmMap = useMemo(() => new Map(paymentMethods.map((m) => [m.id, m])), [paymentMethods]);
  const userColorMap = useMemo(() => buildUserColorMap(users.map((u) => u.id)), [users]);
  // Longest visible-character count across all user names (full-width counts as 1)
  const userMaxNameLen = useMemo(
    () => Math.max(1, ...users.map((u) => [...u.name].length)),
    [users],
  );
  const sharedCats = categories.filter((c) => c.type === "shared" && c.is_active);

  // Build all filter keys (category ids + non-variable kinds)
  const allFilterKeys = useMemo(() => {
    const keys: string[] = [];
    for (const c of sharedCats) keys.push(`cat:${c.id}`);
    for (const o of OTHER_KIND_OPTIONS) keys.push(`kind:${o.value}`);
    return keys;
  }, [sharedCats]);
  // Initialize with all keys on mount. Use a lazy initializer so this runs
  // only once and does NOT re-run on state changes (which caused 全解除 to
  // immediately re-select everything via the useEffect).
  const [selectedFilters, setSelectedFilters] = useState<Set<string>>(
    () => new Set([
      ...categories.filter((c) => c.type === "shared" && c.is_active).map((c) => `cat:${c.id}`),
      ...OTHER_KIND_OPTIONS.map((o) => `kind:${o.value}`),
    ])
  );
  const toggleFilter = (k: string) =>
    setSelectedFilters((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  const allFiltersSelected = selectedFilters.size === allFilterKeys.length;

  /* ----- Summary (always current month) ----- */
  const summary = useMemo(() => {
    const breakdown = computeBreakdown(users, transactions, fixedCostMasters);
    const incomeTotal = Array.from(breakdown.perUser.values()).reduce((a, b) => a + b.income, 0);
    const expenseTotal =
      breakdown.sharedExpenseTotal + breakdown.specialOut +
      Array.from(breakdown.perUser.values()).reduce((a, b) => a + b.personal + b.personalFixed, 0);

    const sharedVarSpent: Record<string, number> = {};
    for (const c of sharedCats) sharedVarSpent[c.id] = 0;
    for (const t of transactions) {
      if (
        !t.is_advance_payment &&
        t.category_type === "variable" &&
        t.category_id &&
        sharedVarSpent[t.category_id] !== undefined
      ) {
        sharedVarSpent[t.category_id] += t.amount;
      }
    }

    const advanceBalance = transactions
      .filter((t) => t.is_advance_payment && !t.advance_settled)
      .reduce((a, t) => a + (t.category_type === "transfer_in" ? -t.amount : t.amount), 0);

    return {
      income: incomeTotal,
      expense: expenseTotal,
      byUser: breakdown.perUser,
      sharedVarSpent,
      advanceBalance,
    };
  }, [transactions, users, sharedCats, fixedCostMasters]);

  /* ----- Predicted cash balance after the next big credit-card draw ----- */
  const predictedBalance = useMemo(() => {
    if (cashSnapshots.length === 0) return null;
    const today = todayIso();
    const card = paymentMethods.find((m) => m.type === "credit_card" && m.payment_day != null);
    const targetDay = card?.payment_day ?? 10;
    const target = nextDayOfMonth(today, targetDay);
    // fromDate を渡すと anchor 日〜fromDate 間のイベントが累積から漏れて
    // Dashboard の CashFlowProjection と値がズレる。anchor 日起点に揃える
    // ため fromDate は省略する。
    const proj = buildCashFlowProjection({
      snapshots: cashSnapshots,
      transactions: allTransactions,
      paymentMethods,
      fixedCostMasters,
      endDate: target,
    });
    const day = proj.days.find((d) => d.date === target);
    const balance = day ? day.balance : proj.anchor?.balance ?? null;
    return { date: target, balance, dayOfMonth: targetDay };
  }, [cashSnapshots, allTransactions, paymentMethods, fixedCostMasters]);

  /* ----- Previous-month summary (for delta indicators) ----- */
  const prevSummary = useMemo(() => {
    const breakdown = computeBreakdown(users, prevTransactions, fixedCostMasters);
    const incomeTotal = Array.from(breakdown.perUser.values()).reduce((a, b) => a + b.income, 0);
    const expenseTotal =
      breakdown.sharedExpenseTotal + breakdown.specialOut +
      Array.from(breakdown.perUser.values()).reduce((a, b) => a + b.personal + b.personalFixed, 0);
    return { income: incomeTotal, expense: expenseTotal };
  }, [prevTransactions, users, fixedCostMasters]);

  const budgetAlerts = sharedCats
    .map((c) => {
      const spent = summary.sharedVarSpent[c.id] ?? 0;
      const ratio = c.budget_amount > 0 ? spent / c.budget_amount : 0;
      return { c, spent, ratio };
    })
    .filter((x) => x.ratio >= 0.8);

  /* ----- Submit ----- */
  function reset() {
    setAmount("");
    setCategoryId(null);
    setTxnKind("variable");
    setNote("");
    setDate(todayIso());
    setIsAdvance(false);
    setSplitMode(false);
    setSplitOurAmount("");
    setPaymentMethodId(defaultPaymentMethodId);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    // Dismiss the on-screen keyboard before validating / submitting
    if (typeof document !== "undefined") {
      (document.activeElement as HTMLElement | null)?.blur();
    }
    setError(null);
    const amt = parseInt(amount.replace(/,/g, ""), 10);
    if (!userId) return setError("支払い者を選択してください。");
    if (!Number.isFinite(amt) || amt <= 0) return setError("金額を入力してください。");
    if (txnKind === "variable") {
      if (!categoryId) return setError("項目を選択してください。");
    }

    // Split mode: a single card swipe split into 家計 + 立替. Only valid for new entries
    // (editing a single existing row falls through to the regular upsert path).
    if (splitMode && !editingTxn) {
      const ourAmt = parseInt(splitOurAmount.replace(/,/g, ""), 10);
      if (!Number.isFinite(ourAmt) || ourAmt <= 0) return setError("家計分の金額を入力してください。");
      if (ourAmt >= amt) return setError("家計分は総額より小さくしてください。");
      const advAmt = amt - ourAmt;
      startTransition(async () => {
        try {
          await createSplitTransaction({
            date,
            user_id: userId,
            our_amount: ourAmt,
            advance_amount: advAmt,
            category_type: txnKind,
            category_id: txnKind === "variable" ? categoryId : null,
            note: note || null,
            payment_method_id: paymentMethodId,
          });
          reset();
          setEntryOpen(false);
          toast.success(`記録しました（家計 ¥${ourAmt.toLocaleString()} / 立替 ¥${advAmt.toLocaleString()}）`);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          setError(msg);
          toast.error(msg);
        }
      });
      return;
    }

    startTransition(async () => {
      try {
        await upsertTransaction({
          id: editingTxn?.id,
          date,
          user_id: userId,
          amount: amt,
          category_type: txnKind,
          category_id: txnKind === "variable" ? categoryId : null,
          note: note || null,
          is_advance_payment: isAdvance,
          payment_method_id: paymentMethodId,
        });
        reset();
        setEntryOpen(false);
        const wasEdit = !!editingTxn;
        setEditingTxn(null);
        toast.success(wasEdit ? "取引を更新しました" : "取引を記録しました");
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        toast.error(msg);
      }
    });
  }

  // When the user taps a transaction's 編集 button, hydrate the entry form with
  // its current values and open the existing entry sheet (which doubles as the
  // edit sheet — same form, same submit path, just with an id).
  useEffect(() => {
    if (!editingTxn) return;
    setUserId(editingTxn.user_id);
    setAmount(String(editingTxn.amount));
    setCategoryId(editingTxn.category_id);
    setTxnKind(editingTxn.category_type);
    setNote(editingTxn.note ?? "");
    setDate(editingTxn.date);
    setIsAdvance(editingTxn.is_advance_payment);
    setPaymentMethodId(editingTxn.payment_method_id);
    setEntryOpen(true);
  }, [editingTxn]);

  /* ============================== UI ============================== */
  return (
    <div className="space-y-6">
      {/* ============ Floating action button ============ */}
      <button
        type="button"
        onClick={() => setEntryOpen(true)}
        aria-label="取引を入力"
        className="fixed right-4 z-40 inline-flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg hover:bg-primary/90 active:scale-95 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] md:bottom-6"
      >
        <Plus className="h-6 w-6" />
      </button>

      {/* ============ Entry sheet ============ */}
      <Sheet
        open={entryOpen}
        onOpenChange={(open) => {
          setEntryOpen(open);
          if (!open) {
            // Closing the sheet: drop any in-flight edit context and reset the form
            // so the next FAB tap opens a clean "新規取引" sheet.
            setEditingTxn(null);
            reset();
            setError(null);
          }
        }}
      >
        <SheetContent side="bottom" className="max-h-[92vh] flex flex-col">
          <SheetHeader>
            <SheetTitle>{editingTxn ? "取引を編集" : "取引を入力"}</SheetTitle>
          </SheetHeader>
          <SheetBody className="flex-1">
            <form
              onSubmit={submit}
              className="space-y-4"
              onClick={(e) => {
                // Tap outside any field/control inside the sheet → dismiss keyboard
                const target = e.target as HTMLElement;
                if (!target.closest("input, textarea, select, button, label")) {
                  (document.activeElement as HTMLElement | null)?.blur();
                }
              }}
            >
          <div>
            <div className="text-xs text-muted-foreground mb-2">① 支払い者</div>
            <div className="flex flex-wrap gap-2">
              {users.map((u) => (
                <button
                  type="button"
                  key={u.id}
                  onClick={() => setUserId(u.id)}
                  className={clsx(
                    "chip border",
                    userId === u.id
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-card border-border"
                  )}
                >
                  {u.name}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="text-xs text-muted-foreground mb-2">② 金額</div>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9,]*"
              enterKeyHint="done"
              className="input text-2xl text-right font-semibold"
              placeholder="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  e.currentTarget.blur();
                }
              }}
            />
          </div>

          <div>
            <div className="text-xs text-muted-foreground mb-2">③ 種類・項目</div>
            <div className="flex flex-wrap gap-2 mb-2 text-xs">
              {(
                [
                  ["variable", "変動"],
                  ["personal", "個人"],
                  ["income", "収入"],
                  ["special", "特別"],
                ] as [TxnKind, string][]
              ).map(([k, label]) => (
                <button
                  type="button"
                  key={k}
                  onClick={() => {
                    setTxnKind(k);
                    setCategoryId(null);
                  }}
                  className={clsx(
                    "chip border",
                    txnKind === k
                      ? "bg-foreground text-background border-foreground"
                      : "bg-card border-border"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            {txnKind === "variable" && (
              <div className="flex flex-wrap gap-2">
                {sharedCats.map((c) => {
                  const colors = colorMap.get(c.id);
                  const selected = categoryId === c.id;
                  return (
                    <button
                      type="button"
                      key={c.id}
                      onClick={() => setCategoryId(c.id)}
                      className="chip border font-medium transition-colors"
                      style={
                        selected
                          ? {
                              backgroundColor: colors?.chart ?? "#2563eb",
                              borderColor: colors?.chart ?? "#2563eb",
                              color: "#fff",
                            }
                          : {
                              backgroundColor: colors?.bg ?? "#f3f4f6",
                              borderColor: colors?.chart ?? "#d1d5db",
                              color: colors?.text ?? "#374151",
                            }
                      }
                    >
                      {c.name}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="space-y-3">
            <label className="block">
              <span className="text-xs text-muted-foreground">日付</span>
              <input
                type="date"
                className="input mt-1"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
            {paymentMethods.length > 0 && (
              <label className="block">
                <span className="text-xs text-muted-foreground">支払方法</span>
                <select
                  className="input mt-1"
                  value={paymentMethodId ?? ""}
                  onChange={(e) => setPaymentMethodId(e.target.value || null)}
                >
                  <option value="">未選択</option>
                  {paymentMethods
                    .filter((m) => !m.user_id || m.user_id === userId)
                    .map((m) => {
                      const ownerName = m.user_id
                        ? userMap.get(m.user_id)?.name ?? ""
                        : "共同";
                      return (
                        <option key={m.id} value={m.id}>
                          {ownerName ? `${m.name}（${ownerName}）` : m.name}
                        </option>
                      );
                    })}
                </select>
              </label>
            )}
            <div>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={isAdvance}
                  onChange={(e) => {
                    setIsAdvance(e.target.checked);
                    if (e.target.checked) setSplitMode(false);
                  }}
                  disabled={splitMode}
                />
                <span className="text-sm">立替（全額が他人の分）</span>
              </label>
              <p className="text-xs text-muted-foreground mt-1">
                立替：金額の全額が他人の分。家計簿の支出には計上されず、後で精算済みにマークできます。
              </p>
            </div>

            {!editingTxn && (
              <div>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={splitMode}
                    onChange={(e) => {
                      setSplitMode(e.target.checked);
                      if (e.target.checked) setIsAdvance(false);
                      else setSplitOurAmount("");
                    }}
                  />
                  <span className="text-sm">グループ精算あり（家計分＋立替分を一括入力）</span>
                </label>
                <p className="text-xs text-muted-foreground mt-1">
                  旅行などで代表払いした場合に使用。総額は上の「② 金額」、家計分を下に入力。差額が立替として自動的に別行で作成されます。
                </p>
                {splitMode && (
                  <div className="mt-2 space-y-1">
                    <div className="text-xs text-muted-foreground">うち家計分</div>
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9,]*"
                      enterKeyHint="done"
                      className="input text-right tabular-nums"
                      placeholder="例: 20000"
                      value={splitOurAmount}
                      onChange={(e) => setSplitOurAmount(e.target.value.replace(/[^\d]/g, ""))}
                    />
                    {(() => {
                      const total = parseInt(amount.replace(/,/g, ""), 10);
                      const ours = parseInt(splitOurAmount.replace(/,/g, ""), 10);
                      if (!Number.isFinite(total) || !Number.isFinite(ours) || ours <= 0 || ours >= total) return null;
                      const adv = total - ours;
                      return (
                        <div className="text-xs text-muted-foreground">
                          内訳: 家計 ¥{ours.toLocaleString()} / 立替 ¥{adv.toLocaleString()}
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
            )}
          </div>

          <label className="block">
            <span className="text-xs text-muted-foreground">補足（任意）</span>
            <input
              className="input mt-1"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="例: スーパー○○で買い物"
            />
          </label>

          {error && <p className="text-sm text-destructive">{error}</p>}

              <button type="submit" className="btn-primary w-full" disabled={pending}>
                {pending ? "送信中..." : "記録する"}
              </button>
            </form>
          </SheetBody>
        </SheetContent>
      </Sheet>

      {/* ============ Unsettled advances sheet ============ */}
      <Sheet open={advancesOpen} onOpenChange={setAdvancesOpen}>
        <SheetContent side="bottom" className="max-h-[92vh] flex flex-col">
          <SheetHeader>
            <SheetTitle>未精算立替の一覧</SheetTitle>
            <SheetDescription>
              振り込まれた日を指定して「精算済みにする」を押すと、その日に予測現金残高が増えます。
            </SheetDescription>
          </SheetHeader>
          <SheetBody className="flex-1">
            {loadingUnsettled && <p className="text-sm text-muted-foreground">読み込み中...</p>}
            {!loadingUnsettled && unsettled && unsettled.length === 0 && (
              <p className="text-sm text-muted-foreground">未精算の立替はありません。</p>
            )}
            {!loadingUnsettled && unsettled && unsettled.length > 0 && (
              <ul className="divide-y divide-border">
                {unsettled.map((t) => (
                  <UnsettledAdvanceRow
                    key={t.id}
                    t={t}
                    paymentMethods={paymentMethods}
                    onSettle={settleAdvance}
                  />
                ))}
              </ul>
            )}
          </SheetBody>
          <SheetFooter>
            <SheetClose asChild>
              <Button variant="ghost">閉じる</Button>
            </SheetClose>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* ============ Bulk edit sheet ============ */}
      <BulkEditSheet
        open={bulkEditOpen}
        onClose={() => setBulkEditOpen(false)}
        selectedIds={selectedIds}
        users={users}
        categories={categories}
        paymentMethods={paymentMethods}
        onApplied={(count) => {
          toast.success(`${count}件更新しました`);
          exitSelection();
          setBulkEditOpen(false);
          router.refresh();
        }}
      />

      {/* ============ Summary (current month) ============ */}
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="card">
          <div className="text-xs text-muted-foreground">収入</div>
          <div className="text-xl font-bold tabular-nums">{yen(summary.income)}</div>
          <DeltaIndicator current={summary.income} previous={prevSummary.income} />
        </div>
        <div className="card">
          <div className="text-xs text-muted-foreground">支出</div>
          <div className="text-xl font-bold tabular-nums">{yen(summary.expense)}</div>
          <DeltaIndicator current={summary.expense} previous={prevSummary.expense} invertColor />
        </div>
        <div className="card">
          <div className="text-xs text-muted-foreground">収支</div>
          <div
            className={clsx(
              "text-xl font-bold tabular-nums",
              summary.income - summary.expense >= 0 ? "text-success" : "text-destructive"
            )}
          >
            {yen(summary.income - summary.expense)}
          </div>
          <DeltaIndicator
            current={summary.income - summary.expense}
            previous={prevSummary.income - prevSummary.expense}
          />
        </div>
        <div className="card ring-2 ring-primary/40">
          <div className="text-xs text-muted-foreground">
            {predictedBalance?.date
              ? `${Number(predictedBalance.date.split("-")[1])}/${Number(predictedBalance.date.split("-")[2])} 引落後の予測残高`
              : "予測現金残高"}
          </div>
          <div
            className={clsx(
              "text-2xl md:text-3xl font-bold tabular-nums whitespace-nowrap",
              predictedBalance == null
                ? "text-muted-foreground"
                : (predictedBalance.balance ?? 0) < 0
                  ? "text-[hsl(var(--destructive))]"
                  : "text-[hsl(var(--primary))]"
            )}
          >
            {predictedBalance?.balance != null ? yen(predictedBalance.balance) : "—"}
          </div>
        </div>
      </section>

      <section className="card">
        <div className="text-sm font-semibold mb-3">
          {formatJaMonth(currentMonth + "-01")} のユーザー別収支
        </div>
        <div className="grid grid-cols-2 gap-3">
          {users.map((u) => {
            const b = summary.byUser.get(u.id) ?? {
              income: 0,
              expense: 0,
              net: 0,
              sharedShare: 0,
              specialShare: 0,
              personal: 0,
              personalFixed: 0,
            };
            const colors = userColor(userColorMap, u.id);
            return (
              <div key={u.id} className={clsx("rounded-xl border-l-4 border border-border p-3", colors.border)}>
                <div className="flex items-center gap-1.5">
                  <span className={clsx("h-2 w-2 rounded-full", colors.dot)} aria-hidden="true" />
                  <div className={clsx("text-sm font-medium", colors.text)}>{u.name}</div>
                </div>
                <div className="mt-1 text-xs tabular-nums">収入 {yen(b.income)}</div>
                <div className="text-xs tabular-nums">支出 {yen(b.expense)}</div>
                <div
                  className={clsx(
                    "mt-1 font-semibold tabular-nums",
                    b.net >= 0 ? "text-success" : "text-destructive"
                  )}
                >
                  {yen(b.net)}
                </div>
              </div>
            );
          })}
        </div>
        {summary.advanceBalance !== 0 && (
          <button
            type="button"
            onClick={openAdvancesModal}
            className="mt-3 w-full rounded-xl bg-warning/10 border border-warning/30 text-warning p-3 text-sm text-left hover:bg-warning/20 transition-colors"
          >
            🔄 今月の未精算立替残高: <strong>{yen(summary.advanceBalance)}</strong>
            <span className="ml-2 text-xs opacity-80">タップして一覧・精算</span>
          </button>
        )}
      </section>

      {/* ============ Budget progress ============ */}
      <section className="card">
        <div className="text-sm font-semibold mb-1">共同変動費 予算進捗</div>
        {(() => {
          const rows = sharedCats
            .filter((c) => c.budget_amount > 0 || (summary.sharedVarSpent[c.id] ?? 0) > 0)
            .map((c) => {
              const spent = summary.sharedVarSpent[c.id] ?? 0;
              const budget = c.budget_amount;
              const ratio = budget > 0 ? spent / budget : 0;
              return { c, spent, budget, ratio };
            });
          const totalSpent = rows.reduce((s, r) => s + r.spent, 0);
          const totalBudget = rows.reduce((s, r) => s + r.budget, 0);
          const totalRatio = totalBudget > 0 ? totalSpent / totalBudget : 0;
          // Scale: 100% maps to `scale`% of the bar so the worst overage hits ~100% width.
          const maxRatio = Math.max(1, totalRatio, ...rows.map((r) => r.ratio));
          const scale = 100 / maxRatio;
          const renderBar = (ratio: number, color?: string) => {
            const safePct = Math.min(ratio, 1) * scale;
            const overPct = Math.max(0, ratio - 1) * scale;
            const safeColor = ratio >= 0.8 ? "hsl(var(--warning))" : color ?? "hsl(var(--primary))";
            return (
              <div
                className="relative h-2.5 rounded-full bg-muted mt-1 overflow-hidden"
                role="progressbar"
                aria-valuenow={Math.round(ratio * 100)}
                aria-valuemin={0}
                aria-valuemax={Math.round(maxRatio * 100)}
              >
                {/* Filled portion up to 100% (or actual value if under 100%) */}
                {safePct > 0 && (
                  <div
                    className="absolute inset-y-0 left-0"
                    style={{ width: `${safePct}%`, backgroundColor: safeColor }}
                  />
                )}
                {/* Overage portion past 100%, in red */}
                {overPct > 0 && (
                  <div
                    className="absolute inset-y-0"
                    style={{
                      left: `${scale}%`,
                      width: `${overPct}%`,
                      backgroundColor: "hsl(var(--destructive))",
                    }}
                  />
                )}
                {/* Solid 100% reference line (only meaningful when scale<100, i.e. some row is over budget) */}
                {scale < 100 && (
                  <div
                    className="absolute inset-y-0"
                    style={{
                      left: `calc(${scale}% - 1px)`,
                      width: 2,
                      backgroundColor: "hsl(var(--foreground) / 0.7)",
                    }}
                    aria-label="100%"
                  />
                )}
              </div>
            );
          };
          return (
            <>
              <p className="text-xs text-muted-foreground mb-3">
                {scale < 100
                  ? `最大超過 ${Math.round(maxRatio * 100)}% に合わせてスケール。100% 位置に縦線、超過分は赤色。`
                  : "予算内で進捗中。"}
              </p>
              <div className="space-y-2">
                {rows.map(({ c, spent, budget, ratio }) => {
                  const colors = colorMap.get(c.id);
                  const over = budget > 0 && spent > budget;
                  const warn = budget > 0 && spent >= budget * 0.8;
                  const pct = budget > 0 ? Math.round(ratio * 100) : null;
                  return (
                    <div key={c.id}>
                      <div className="flex justify-between text-xs items-center">
                        <span className="flex items-center gap-2 min-w-0">
                          <span
                            className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: colors?.chart ?? "#d1d5db" }}
                          />
                          <span className="truncate">{c.name}</span>
                          {over && <span className="chip bg-destructive/15 text-destructive">超過</span>}
                          {!over && warn && (
                            <span className="chip bg-warning/15 text-warning">注意</span>
                          )}
                        </span>
                        <span className="tabular-nums shrink-0">
                          {yen(spent)} / {yen(budget)}
                          {pct !== null && (
                            <span className={clsx("ml-2 font-semibold", over && "text-destructive", !over && warn && "text-warning")}>
                              {pct}%
                            </span>
                          )}
                        </span>
                      </div>
                      {renderBar(ratio, colors?.chart)}
                    </div>
                  );
                })}
                {rows.length > 0 && (
                  <div className="pt-2 mt-1 border-t border-border">
                    <div className="flex justify-between text-xs items-center">
                      <span className="flex items-center gap-2 font-semibold">
                        共同変動費 合計
                        {totalSpent > totalBudget && totalBudget > 0 && (
                          <span className="chip bg-destructive/15 text-destructive">
                            超過 {yen(totalSpent - totalBudget)}
                          </span>
                        )}
                      </span>
                      <span className="tabular-nums shrink-0 font-semibold">
                        {yen(totalSpent)} / {yen(totalBudget)}
                        {totalBudget > 0 && (
                          <span className={clsx("ml-2", totalSpent > totalBudget && "text-destructive")}>
                            {Math.round(totalRatio * 100)}%
                          </span>
                        )}
                      </span>
                    </div>
                    {renderBar(totalRatio)}
                  </div>
                )}
              </div>
            </>
          );
        })()}
        {budgetAlerts.length > 0 && (
          <NotifyButton alerts={budgetAlerts.map((a) => ({ name: a.c.name, ratio: a.ratio }))} />
        )}
      </section>

      {/* ============ Transaction list with month navigator ============ */}
      <section className="card">
        {/* Month navigator */}
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-semibold">
            {formatJaMonth(viewMonth + "-01")} の取引
            {loadingTxns && <span className="ml-2 text-xs text-muted-foreground">読み込み中...</span>}
            {!loadingTxns && (
              <span className="ml-1 text-xs text-muted-foreground">({viewTransactions.length}件)</span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              className="chip border bg-card border-border text-muted-foreground px-2 py-1 text-sm disabled:opacity-30"
              disabled={viewMonthIdx >= monthOptions.length - 1}
              onClick={() => handleViewMonthChange(monthOptions[viewMonthIdx + 1])}
              aria-label="前月"
            >
              ‹
            </button>
            <select
              className="input text-xs py-1 px-2 w-auto"
              value={viewMonth}
              onChange={(e) => handleViewMonthChange(e.target.value)}
            >
              {monthOptions.map((m) => (
                <option key={m} value={m}>
                  {formatJaMonth(m + "-01")}
                </option>
              ))}
            </select>
            <button
              className="chip border bg-card border-border text-muted-foreground px-2 py-1 text-sm disabled:opacity-30"
              disabled={viewMonthIdx <= 0}
              onClick={() => handleViewMonthChange(monthOptions[viewMonthIdx - 1])}
              aria-label="翌月"
            >
              ›
            </button>
          </div>
        </div>

        {/* Filter trigger + sort row */}
        <div className="flex items-center justify-between gap-2 mb-3">
          <button
            type="button"
            onClick={() => setFilterOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-foreground hover:bg-accent transition-colors"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
            <span>絞り込み</span>
            {!allFiltersSelected && (
              <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground tabular-nums">
                {selectedFilters.size}/{allFilterKeys.length}
              </span>
            )}
          </button>
          <div className="flex gap-1 text-xs">
            {(
              [
                ["date", "日付"],
                ["amount_desc", "金額↓"],
                ["amount_asc", "金額↑"],
              ] as [SortKey, string][]
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setSortKey(k)}
                className={clsx(
                  "chip border text-xs whitespace-nowrap",
                  sortKey === k
                    ? "bg-foreground text-background border-foreground"
                    : "bg-card border-border text-muted-foreground"
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Filter Sheet */}
        <Sheet open={filterOpen} onOpenChange={setFilterOpen}>
          <SheetContent side="right" className="flex flex-col">
            <SheetHeader>
              <SheetTitle>絞り込み</SheetTitle>
              <SheetDescription>
                {allFiltersSelected
                  ? "すべての取引を表示中"
                  : `${selectedFilters.size} / ${allFilterKeys.length} 種類を表示中`}
              </SheetDescription>
            </SheetHeader>
            <SheetBody className="flex-1 space-y-5">
              <button
                type="button"
                onClick={() =>
                  setSelectedFilters(allFiltersSelected ? new Set() : new Set(allFilterKeys))
                }
                className="w-full rounded-xl border border-border bg-card hover:bg-accent transition-colors px-3 py-2 text-sm font-medium text-foreground"
              >
                {allFiltersSelected ? "すべて外す" : "すべて選択"}
              </button>

              <div>
                <div className="text-xs text-muted-foreground mb-2 font-medium">変動費カテゴリ</div>
                <div className="flex flex-wrap gap-1.5">
                  {sharedCats.map((c) => {
                    const key = `cat:${c.id}`;
                    const active = selectedFilters.has(key);
                    const colors = colorMap.get(c.id);
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => toggleFilter(key)}
                        className="chip border text-xs font-medium transition-colors"
                        style={
                          active
                            ? {
                                backgroundColor: colors?.chart ?? "#2563eb",
                                borderColor: colors?.chart ?? "#2563eb",
                                color: "#fff",
                              }
                            : {
                                backgroundColor: colors?.bg ?? "transparent",
                                borderColor: colors?.chart ?? "#d1d5db",
                                color: colors?.text ?? "#6b7280",
                                opacity: 0.55,
                              }
                        }
                      >
                        {c.name}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <div className="text-xs text-muted-foreground mb-2 font-medium">その他の種類</div>
                <div className="flex flex-wrap gap-1.5">
                  {OTHER_KIND_OPTIONS.map((o) => {
                    const key = `kind:${o.value}`;
                    const active = selectedFilters.has(key);
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => toggleFilter(key)}
                        className={clsx(
                          "chip border text-xs",
                          active
                            ? "bg-foreground text-background border-foreground"
                            : "bg-muted border-border text-muted-foreground"
                        )}
                      >
                        {o.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </SheetBody>
            <SheetFooter>
              <SheetClose asChild>
                <Button className="w-full">適用して閉じる</Button>
              </SheetClose>
            </SheetFooter>
          </SheetContent>
        </Sheet>

        {/* Selection toolbar */}
        <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
          {!selectionMode ? (
            <button
              type="button"
              className="chip border bg-card border-border text-xs"
              onClick={() => setSelectionMode(true)}
            >
              選択
            </button>
          ) : (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-muted-foreground">{selectedIds.size}件選択中</span>
                <button
                  type="button"
                  className="chip border bg-card border-border text-xs"
                  onClick={() => {
                    const visible = [...viewTransactions]
                      .filter((t) => {
                        if (t.category_type === "variable") {
                          return t.category_id
                            ? selectedFilters.has(`cat:${t.category_id}`)
                            : selectedFilters.has(`kind:variable`);
                        }
                        return selectedFilters.has(`kind:${t.category_type}`);
                      });
                    const allSelected = visible.length > 0 && visible.every((t) => selectedIds.has(t.id));
                    setSelectedIds(allSelected ? new Set() : new Set(visible.map((t) => t.id)));
                  }}
                >
                  全選択 / 解除
                </button>
              </div>
              <div className="flex items-center gap-2">
                {selectedIds.size > 0 && (
                  <>
                    <button
                      type="button"
                      className="chip border bg-primary text-primary-foreground border-primary text-xs"
                      onClick={() => setBulkEditOpen(true)}
                    >
                      編集 ({selectedIds.size})
                    </button>
                    <button
                      type="button"
                      className="chip border bg-destructive text-destructive-foreground border-destructive text-xs"
                      onClick={() => {
                        if (!confirm(`${selectedIds.size}件の取引を削除しますか？この操作は取り消せません。`)) return;
                        startTransition(async () => {
                          try {
                            await bulkDeleteTransactions({ ids: [...selectedIds] });
                            toast.success(`${selectedIds.size}件削除しました`);
                            exitSelection();
                            router.refresh();
                          } catch (err: unknown) {
                            toast.error(err instanceof Error ? err.message : String(err));
                          }
                        });
                      }}
                    >
                      削除 ({selectedIds.size})
                    </button>
                  </>
                )}
                <button
                  type="button"
                  className="chip border bg-card border-border text-xs"
                  onClick={exitSelection}
                >
                  キャンセル
                </button>
              </div>
            </>
          )}
        </div>

        <ul className="divide-y divide-border">
          {[...viewTransactions]
            .filter((t) => {
              if (t.category_type === "variable") {
                return t.category_id
                  ? selectedFilters.has(`cat:${t.category_id}`)
                  : selectedFilters.has(`kind:variable`);
              }
              return selectedFilters.has(`kind:${t.category_type}`);
            })
            .sort((a, b) => {
              if (sortKey === "amount_desc") return b.amount - a.amount;
              if (sortKey === "amount_asc") return a.amount - b.amount;
              return a.date < b.date ? 1 : a.date > b.date ? -1 : 0;
            })
            .map((t) => (
            <TxnRow
              key={t.id}
              t={t}
              userName={userMap.get(t.user_id)?.name ?? "?"}
              userColors={userColor(userColorMap, t.user_id)}
              userMaxNameLen={userMaxNameLen}
              categoryName={t.category_id ? catMap.get(t.category_id)?.name ?? null : null}
              categoryColors={t.category_id ? colorMap.get(t.category_id) : undefined}
              paymentMethod={t.payment_method_id ? pmMap.get(t.payment_method_id) ?? null : null}
              selectionMode={selectionMode}
              selected={selectedIds.has(t.id)}
              onToggleSelect={() => toggleSelected(t.id)}
              onEdit={() => setEditingTxn(t)}
            />
          ))}
          {viewTransactions.filter((t) => {
            if (t.category_type === "variable") {
              return t.category_id
                ? selectedFilters.has(`cat:${t.category_id}`)
                : selectedFilters.has(`kind:variable`);
            }
            return selectedFilters.has(`kind:${t.category_type}`);
          }).length === 0 && !loadingTxns && (
            <li className="py-4 text-center text-sm text-muted-foreground">
              {selectedFilters.size === 0 ? "表示項目を選択してください。" : "取引がありません。"}
            </li>
          )}
        </ul>
      </section>
    </div>
  );
}

/* -------------------- DeltaIndicator -------------------- */
function DeltaIndicator({
  current,
  previous,
  invertColor = false,
}: {
  current: number;
  previous: number;
  invertColor?: boolean;
}) {
  if (previous === 0 && current === 0) return null;
  if (previous === 0) {
    return <div className="text-xs text-muted-foreground mt-0.5">前月: ¥0</div>;
  }
  const delta = current - previous;
  const ratio = (delta / Math.abs(previous)) * 100;
  const isUp = delta > 0;
  const isDown = delta < 0;
  // For income/net: up = good (success), down = bad (destructive).
  // For expense (invertColor=true): down = good (saved), up = bad.
  const positive = invertColor ? isDown : isUp;
  const negative = invertColor ? isUp : isDown;
  const colorClass = positive
    ? "text-success"
    : negative
      ? "text-destructive"
      : "text-muted-foreground";
  const arrow = isUp ? "↑" : isDown ? "↓" : "→";
  const display = Math.abs(ratio) > 999 ? ">999" : Math.abs(ratio).toFixed(0);
  return (
    <div className={clsx("text-xs mt-0.5 flex items-baseline gap-1 tabular-nums", colorClass)}>
      <span>{arrow}</span>
      <span className="font-medium">{display}%</span>
      <span className="text-muted-foreground text-[10px]">前月比</span>
    </div>
  );
}

/* -------------------- TxnRow -------------------- */
function TxnRow({
  t,
  userName,
  userColors,
  userMaxNameLen,
  categoryName,
  categoryColors,
  paymentMethod,
  selectionMode,
  selected,
  onToggleSelect,
  onEdit,
}: {
  t: TransactionRow;
  userName: string;
  userColors: UserColor;
  userMaxNameLen: number;
  categoryName: string | null;
  categoryColors?: { chart: string; bg: string; text: string };
  paymentMethod: PaymentMethodRow | null;
  selectionMode: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onEdit: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  const sign = t.category_type === "income" ? "+" : "-";
  const amountColor = t.category_type === "income" ? "text-success" : "text-foreground";

  const label =
    t.subcategory ||
    categoryName ||
    ({
      income: "収入",
      fixed: "固定費",
      loan: "ローン",
      variable: "変動",
      personal: "個人",
      transfer_in: "振込(入)",
      transfer_out: "振込(出)",
      special: "特別",
      investment: "投資",
    } as const)[t.category_type];

  // Compact date: e.g. "2026-04-30" -> "4/30" so it never wraps
  const [, mm, dd] = t.date.split("-");
  const shortDate = `${parseInt(mm, 10)}/${parseInt(dd, 10)}`;

  // Chip width = max name length (em ≈ full-width char) + horizontal padding
  const userChipMinWidth = `calc(${userMaxNameLen}em + 1.25rem)`;

  return (
    <li className={clsx("py-2", selectionMode && selected && "bg-primary/5 -mx-2 px-2 rounded")}>
      <button
        type="button"
        className="w-full flex items-start gap-2 text-left tabular-nums"
        onClick={() => (selectionMode ? onToggleSelect() : setOpen((v) => !v))}
      >
        {selectionMode && (
          <div className="pt-0.5 shrink-0">
            <input
              type="checkbox"
              checked={selected}
              onChange={onToggleSelect}
              onClick={(e) => e.stopPropagation()}
              className="h-4 w-4"
              aria-label="選択"
            />
          </div>
        )}
        <div className="text-xs text-muted-foreground w-10 shrink-0 text-center whitespace-nowrap pt-0.5">
          {shortDate}
        </div>
        <div
          className={clsx(
            "text-xs rounded-full px-2 py-0.5 shrink-0 text-center font-medium border whitespace-nowrap",
            userColors.bg,
            userColors.text,
            userColors.border,
          )}
          style={{ minWidth: userChipMinWidth }}
        >
          {userName}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            {t.is_advance_payment && <span aria-hidden="true" className="shrink-0">🔄</span>}
            <span
              className="text-xs rounded-full px-2 py-0.5 font-medium shrink-0 truncate max-w-[140px]"
              style={
                categoryColors
                  ? { backgroundColor: categoryColors.bg, color: categoryColors.text }
                  : undefined
              }
            >
              {label}
            </span>
            {paymentMethod && (
              <span
                className={clsx(
                  "text-[10px] rounded-full px-2 py-0.5 font-medium shrink-0 truncate max-w-[160px] border",
                  paymentMethod.type === "credit_card"
                    ? "bg-primary/10 text-primary border-primary/30"
                    : paymentMethod.type === "transfer"
                    ? "bg-muted text-muted-foreground border-border"
                    : "bg-muted text-muted-foreground border-border",
                )}
                title={paymentMethod.name}
              >
                {paymentMethod.type === "credit_card" ? "💳 " : paymentMethod.type === "transfer" ? "🏦 " : "💴 "}
                {paymentMethod.name}
              </span>
            )}
          </div>
          {t.note && (
            <div
              className={clsx(
                "text-xs text-muted-foreground mt-0.5",
                open ? "whitespace-pre-wrap break-words" : "truncate",
              )}
            >
              {t.note}
            </div>
          )}
        </div>
        <div className={clsx("font-semibold shrink-0 text-right tabular-nums whitespace-nowrap pt-0.5", amountColor)}>
          {sign}
          {yen(t.amount).replace("-", "")}
        </div>
      </button>
      {open && !selectionMode && (
        <div className="mt-2 flex gap-2 flex-wrap text-xs justify-end">
          {t.is_advance_payment && (
            <button
              className="btn-ghost text-xs py-1 px-2"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  try {
                    await toggleAdvanceSettled(t.id, !t.advance_settled);
                    toast.success(t.advance_settled ? "未精算に戻しました" : "精算済みにしました");
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : String(err));
                  }
                })
              }
            >
              {t.advance_settled ? "未精算に戻す" : "精算済みにする"}
            </button>
          )}
          <button
            type="button"
            className="btn-primary text-xs py-1 px-2"
            disabled={pending}
            onClick={() => {
              setOpen(false);
              onEdit();
            }}
          >
            編集
          </button>
          <button
            className="btn-danger text-xs py-1 px-2"
            disabled={pending}
            onClick={() => {
              if (!confirm("この取引を削除しますか？")) return;
              start(async () => {
                try {
                  await deleteTransaction(t.id);
                  toast.success("取引を削除しました");
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : String(err));
                }
              });
            }}
          >
            削除
          </button>
        </div>
      )}
    </li>
  );
}

/* -------------------- Web notifications -------------------- */
function NotifyButton({ alerts }: { alerts: { name: string; ratio: number }[] }) {
  async function notify() {
    if (!("Notification" in window)) return alert("この環境は通知に対応していません。");
    const perm =
      Notification.permission === "granted"
        ? "granted"
        : await Notification.requestPermission();
    if (perm !== "granted") return;
    const lines = alerts.map((a) => `${a.name}: ${(a.ratio * 100).toFixed(0)}%`).join("\n");
    new Notification("予算アラート", { body: lines });
  }
  return (
    <button type="button" onClick={notify} className="btn-ghost text-xs mt-3">
      🔔 予算アラートを通知
    </button>
  );
}

/* -------------------- BulkEditSheet -------------------- */
type BulkField = "payment_method_id" | "user_id" | "date" | "category_type" | "category_id";

function BulkEditSheet({
  open,
  onClose,
  selectedIds,
  users,
  categories,
  paymentMethods,
  onApplied,
}: {
  open: boolean;
  onClose: () => void;
  selectedIds: Set<string>;
  users: UserRow[];
  categories: CategoryRow[];
  paymentMethods: PaymentMethodRow[];
  onApplied: (count: number) => void;
}) {
  const [field, setField] = useState<BulkField>("payment_method_id");
  const [value, setValue] = useState<string>("");
  const [pending, start] = useTransition();
  const ids = useMemo(() => [...selectedIds], [selectedIds]);

  function applyEdit() {
    const patch: Record<string, unknown> = {};
    if (field === "payment_method_id") patch.payment_method_id = value || null;
    else if (field === "user_id") {
      if (!value) return;
      patch.user_id = value;
    } else if (field === "date") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
      patch.date = value;
    } else if (field === "category_type") {
      if (!value) return;
      patch.category_type = value;
      // Reset category_id when switching kind away from variable to avoid stale
      // links. Server is permissive and doesn't enforce this, but keeping the
      // data consistent is the right call.
      if (value !== "variable") patch.category_id = null;
    } else if (field === "category_id") {
      if (!value) return;
      patch.category_id = value;
      patch.category_type = "variable";
    }

    start(async () => {
      try {
        const n = await bulkUpdateTransactions({ ids, patch });
        onApplied(n);
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" className="max-h-[80vh] flex flex-col">
        <SheetHeader>
          <SheetTitle>一括編集</SheetTitle>
          <SheetDescription>
            選択した {ids.length} 件の取引にまとめて適用します。
          </SheetDescription>
        </SheetHeader>
        <SheetBody className="flex-1 space-y-4">
          <label className="block">
            <span className="text-xs text-muted-foreground">変更する項目</span>
            <select
              className="input mt-1"
              value={field}
              onChange={(e) => {
                setField(e.target.value as BulkField);
                setValue("");
              }}
            >
              <option value="payment_method_id">支払方法</option>
              <option value="user_id">支払者</option>
              <option value="date">日付</option>
              <option value="category_type">取引種別</option>
              <option value="category_id">カテゴリ（変動費）</option>
            </select>
          </label>

          {field === "payment_method_id" && (
            <label className="block">
              <span className="text-xs text-muted-foreground">新しい支払方法</span>
              <select className="input mt-1" value={value} onChange={(e) => setValue(e.target.value)}>
                <option value="">未設定（NULL に戻す）</option>
                {paymentMethods.map((m) => {
                  const owner = m.user_id ? users.find((u) => u.id === m.user_id)?.name ?? "" : "共同";
                  return (
                    <option key={m.id} value={m.id}>
                      {m.name}（{owner}）
                    </option>
                  );
                })}
              </select>
            </label>
          )}

          {field === "user_id" && (
            <label className="block">
              <span className="text-xs text-muted-foreground">新しい支払者</span>
              <select className="input mt-1" value={value} onChange={(e) => setValue(e.target.value)}>
                <option value="">選択</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          {field === "date" && (
            <label className="block">
              <span className="text-xs text-muted-foreground">新しい日付</span>
              <input
                type="date"
                className="input mt-1"
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </label>
          )}

          {field === "category_type" && (
            <label className="block">
              <span className="text-xs text-muted-foreground">新しい取引種別</span>
              <select className="input mt-1" value={value} onChange={(e) => setValue(e.target.value)}>
                <option value="">選択</option>
                <option value="variable">変動</option>
                <option value="personal">個人</option>
                <option value="income">収入</option>
                <option value="fixed">固定費</option>
                <option value="loan">ローン</option>
                <option value="special">特別</option>
                <option value="investment">投資</option>
                <option value="transfer_in">振込(入)</option>
                <option value="transfer_out">振込(出)</option>
              </select>
            </label>
          )}

          {field === "category_id" && (
            <label className="block">
              <span className="text-xs text-muted-foreground">新しいカテゴリ（変動費）</span>
              <select className="input mt-1" value={value} onChange={(e) => setValue(e.target.value)}>
                <option value="">選択</option>
                {categories
                  .filter((c) => c.is_active && c.type === "shared")
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </label>
          )}
        </SheetBody>
        <SheetFooter>
          <button
            type="button"
            className="btn-primary w-full"
            disabled={pending || ids.length === 0}
            onClick={applyEdit}
          >
            {pending ? "更新中..." : `${ids.length}件に適用`}
          </button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

/* =================== Unsettled advance row =================== */
function UnsettledAdvanceRow({
  t,
  paymentMethods,
  onSettle,
}: {
  t: TransactionRow;
  paymentMethods: PaymentMethodRow[];
  onSettle: (id: string, settledAt: string) => void | Promise<void>;
}) {
  const [settledAt, setSettledAt] = useState(todayIso());
  const [pending, startTransition] = useTransition();
  const pmName = t.payment_method_id
    ? paymentMethods.find((m) => m.id === t.payment_method_id)?.name ?? "—"
    : "—";
  return (
    <li className="py-3 space-y-2">
      <div className="flex justify-between items-baseline gap-2">
        <div className="text-sm">
          <div className="font-medium">{formatJaDate(t.date)} ・ {yen(t.amount)}</div>
          <div className="text-xs text-muted-foreground">
            {pmName}{t.note ? ` ・ ${t.note}` : ""}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          振込日
          <input
            type="date"
            className="input py-1 text-sm"
            value={settledAt}
            onChange={(e) => setSettledAt(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="btn-primary text-sm py-1 px-3"
          disabled={pending || !settledAt}
          onClick={() => startTransition(async () => { await onSettle(t.id, settledAt); })}
        >
          {pending ? "..." : "精算済みにする"}
        </button>
      </div>
    </li>
  );
}
