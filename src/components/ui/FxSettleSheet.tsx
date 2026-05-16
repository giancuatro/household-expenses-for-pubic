"use client";

import { useState } from "react";
import type { TransactionRow } from "@/lib/types";
import { formatForeign, getCurrency } from "@/lib/currencyList";

/**
 * Modal that finalizes a pending FX transaction. Two equivalent inputs:
 * the user types EITHER the real exchange rate (preferred when read off a
 * statement) OR the real JPY amount; the other field is back-computed.
 *
 * Kept as a thin lightbox (no Radix dialog dependency) to match the simple
 * inline-overlay pattern already used by the investment edit dialog.
 */
export function FxSettleSheet({
  txn,
  pending,
  onClose,
  onSubmit,
}: {
  txn: TransactionRow;
  pending: boolean;
  onClose: () => void;
  onSubmit: (input: { fxRate?: number; jpyAmount?: number }) => void;
}) {
  const cur = getCurrency(txn.original_currency);
  const orig = txn.original_amount ?? 0;
  const [mode, setMode] = useState<"rate" | "jpy">("rate");
  const [rate, setRate] = useState<string>(txn.fx_rate ? String(txn.fx_rate) : "");
  const [jpy, setJpy] = useState<string>("");
  const [local, setLocal] = useState<string | null>(null);

  const rateNum = parseFloat(rate);
  const jpyNum = parseInt(jpy.replace(/[^\d]/g, ""), 10);
  const previewJpy =
    mode === "rate" && orig > 0 && Number.isFinite(rateNum) && rateNum > 0
      ? Math.round(orig * rateNum)
      : mode === "jpy" && Number.isFinite(jpyNum) && jpyNum > 0
        ? jpyNum
        : null;
  const previewRate =
    mode === "jpy" && orig > 0 && Number.isFinite(jpyNum) && jpyNum > 0
      ? jpyNum / orig
      : mode === "rate" && Number.isFinite(rateNum) && rateNum > 0
        ? rateNum
        : null;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setLocal(null);
    if (mode === "rate") {
      if (!Number.isFinite(rateNum) || rateNum <= 0) {
        setLocal("レートは 0 より大きい数値を入力してください。");
        return;
      }
      onSubmit({ fxRate: rateNum });
    } else {
      if (!Number.isFinite(jpyNum) || jpyNum <= 0) {
        setLocal("確定円額は 1 円以上で入力してください。");
        return;
      }
      onSubmit({ jpyAmount: jpyNum });
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="w-full max-w-md bg-card border border-border rounded-xl p-5 shadow-xl space-y-3"
      >
        <h3 className="font-semibold text-base">FX を確定</h3>
        <p className="text-xs text-muted-foreground">
          原価 <span className="font-mono">{formatForeign(orig, cur.code)}</span>
          {" "}・ 入力時の見積り <span className="font-mono">¥{txn.amount.toLocaleString("ja-JP")}</span>
        </p>

        <div className="flex gap-2 text-xs">
          <button
            type="button"
            className={`chip border ${mode === "rate" ? "bg-foreground text-background border-foreground" : "bg-card border-border"}`}
            onClick={() => setMode("rate")}
          >
            レートで入力
          </button>
          <button
            type="button"
            className={`chip border ${mode === "jpy" ? "bg-foreground text-background border-foreground" : "bg-card border-border"}`}
            onClick={() => setMode("jpy")}
          >
            円額で入力
          </button>
        </div>

        {mode === "rate" ? (
          <label className="block space-y-1">
            <span className="text-xs font-medium">実レート (¥/{cur.code})</span>
            <input
              type="text"
              inputMode="decimal"
              className="input"
              value={rate}
              onChange={(e) => setRate(e.target.value.replace(/[^\d.]/g, ""))}
              placeholder="例: 4.91"
              required
            />
          </label>
        ) : (
          <label className="block space-y-1">
            <span className="text-xs font-medium">確定円額</span>
            <input
              type="text"
              inputMode="numeric"
              className="input"
              value={jpy ? Number(jpy.replace(/[^\d]/g, "")).toLocaleString("ja-JP") : ""}
              onChange={(e) => setJpy(e.target.value)}
              placeholder="例: 5,892"
              required
            />
          </label>
        )}

        {(previewJpy != null || previewRate != null) && (
          <div className="rounded-md bg-muted/50 px-3 py-2 text-xs space-y-0.5">
            {previewJpy != null && (
              <div>
                確定円額: <span className="font-semibold">¥{previewJpy.toLocaleString("ja-JP")}</span>
              </div>
            )}
            {previewRate != null && (
              <div>
                実レート: <span className="font-mono">{previewRate.toFixed(4)}</span> ¥/{cur.code}
              </div>
            )}
          </div>
        )}

        {local && <p className="text-xs text-destructive">{local}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-secondary text-sm" onClick={onClose} disabled={pending}>
            キャンセル
          </button>
          <button type="submit" className="btn-primary text-sm" disabled={pending}>
            {pending ? "保存中..." : "確定"}
          </button>
        </div>
      </form>
    </div>
  );
}
