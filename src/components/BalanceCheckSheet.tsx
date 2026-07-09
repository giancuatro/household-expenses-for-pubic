"use client";

import { useEffect, useState, useTransition } from "react";
import { Sheet, SheetContent, SheetHeader, SheetBody, SheetFooter, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { MoneyInput } from "@/components/ui/MoneyInput";
import { getPredictedBalance, reconcileCashBalance } from "@/app/actions/settings";
import { todayIso, yen, yenSigned } from "@/lib/format";
import { toast } from "@/lib/toast";

/**
 * Bottom sheet that reconciles the real cash balance against the projection.
 * On open it fetches the predicted balance for the chosen date; the difference
 * is booked as an 不明金 transaction on confirm and a fresh snapshot re-anchors
 * the prediction. Controlled via `open` / `onOpenChange` so multiple call sites
 * (settings, reconcile completion, home card) can drive it.
 */
export function BalanceCheckSheet({
  open,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Called after a successful commit — the caller refreshes / navigates. */
  onDone?: () => void;
}) {
  const [date, setDate] = useState(todayIso());
  const [balance, setBalance] = useState("");
  const [predicted, setPredicted] = useState<number | null | undefined>(undefined); // undefined = loading
  const [fxPending, setFxPending] = useState(0);
  const [loading, startLoad] = useTransition();
  const [submitting, startSubmit] = useTransition();

  // (Re)fetch the prediction whenever the sheet opens or the date changes.
  useEffect(() => {
    if (!open) return;
    setPredicted(undefined);
    startLoad(async () => {
      try {
        const r = await getPredictedBalance({ as_of_date: date });
        setPredicted(r.predicted);
        setFxPending(r.fxPendingCount);
      } catch {
        setPredicted(null);
        setFxPending(0);
      }
    });
  }, [open, date]);

  const actual = balance === "" ? null : parseInt(balance, 10);
  const diff = predicted != null && actual != null ? actual - predicted : null;

  function commit() {
    if (actual == null) {
      toast.error("実残高を入力してください。");
      return;
    }
    startSubmit(async () => {
      try {
        const res = await reconcileCashBalance({ as_of_date: date, actual_balance: actual });
        if (res.diff !== 0) {
          toast.success(
            `差額 ${yenSigned(res.diff)} を不明金として記録しました。`,
          );
        } else {
          toast.success("残高を記録しました。");
        }
        setBalance("");
        onOpenChange(false);
        onDone?.();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
      }
    });
  }

  const diffTone =
    diff == null || diff === 0
      ? "text-muted-foreground"
      : diff < 0
        ? "text-destructive"
        : "text-success";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[90vh] flex flex-col">
        <SheetHeader>
          <SheetTitle>実残高と照合</SheetTitle>
          <SheetDescription>
            実際の現金・預金残高を入力すると、予測との差額を「不明金」として記録し、予測を再アンカーします。
          </SheetDescription>
        </SheetHeader>

        <SheetBody className="space-y-4">
          <label className="block text-sm space-y-1">
            <span className="text-muted-foreground">日付</span>
            <input
              className="input"
              type="date"
              value={date}
              max={todayIso()}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>

          <label className="block text-sm space-y-1">
            <span className="text-muted-foreground">実残高（銀行・財布合算）</span>
            <MoneyInput className="input text-lg" placeholder="残高（円）" value={balance} onChange={setBalance} autoFocus />
          </label>

          <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">予測残高</span>
              <span className="tabular-nums">
                {loading || predicted === undefined
                  ? "計算中…"
                  : predicted === null
                    ? "（スナップショット未登録）"
                    : yen(predicted)}
              </span>
            </div>
            <div className="flex justify-between font-medium">
              <span className="text-muted-foreground">差額</span>
              <span className={`tabular-nums ${diffTone}`}>
                {diff == null ? "—" : diff === 0 ? "±0" : yenSigned(diff)}
              </span>
            </div>
            {diff != null && diff !== 0 && (
              <p className="text-xs text-muted-foreground pt-1">
                {diff < 0
                  ? "予測より現金が少ない → 不足分を特別費「不明金」（支出）として計上します。"
                  : "予測より現金が多い → 余剰分を「不明金」（収入）として計上します。"}
                割り勘に含まれます。
              </p>
            )}
          </div>

          {fxPending > 0 && (
            <p className="text-xs rounded-md border border-amber-500/30 bg-amber-500/10 text-amber-700 px-2 py-1.5">
              ✈️ 未確定 FX が {fxPending} 件あります。先にカード明細を取り込むと精度が上がります。
            </p>
          )}
        </SheetBody>

        <SheetFooter>
          <button type="button" className="btn-ghost text-sm border border-border" onClick={() => onOpenChange(false)}>
            キャンセル
          </button>
          <button type="button" className="btn-primary text-sm" disabled={submitting || actual == null} onClick={commit}>
            {diff != null && diff !== 0 ? "差額を記録して照合" : "残高を記録"}
          </button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
