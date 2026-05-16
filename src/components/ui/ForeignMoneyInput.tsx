"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { CURRENCIES, getCurrency, formatForeign } from "@/lib/currencyList";

/**
 * Foreign-currency entry field used by travel mode.
 *
 * Layout:
 *   ┌────────────┐ ┌─────┐
 *   │ 1,200      │ │ TWD │   ← amount + currency selector
 *   └────────────┘ └─────┘
 *   💱 レート 4.85 ¥/TWD（編集）
 *   → 見積り ¥5,820 (未確定)
 *
 * The amount field accepts decimals (foreign amounts are rarely round in
 * yen-equivalent), but rejects garbage. Rate is editable inline. The
 * estimated JPY preview is rendered live so the user sees the budget impact.
 */
export interface ForeignMoneyInputProps {
  amount: string;                              // raw decimal string
  onAmountChange: (s: string) => void;
  currency: string;                            // ISO code
  onCurrencyChange: (code: string) => void;
  rate: string;                                // raw decimal string
  onRateChange: (s: string) => void;
  className?: string;
  /** Default-currency hint shown in the chip if the user hasn't picked yet. */
  tripDefaultCurrency?: string | null;
}

function sanitizeDecimal(s: string): string {
  // Strip everything except digits and one dot. Leading zeros allowed.
  let cleaned = s.replace(/[^\d.]/g, "");
  const firstDot = cleaned.indexOf(".");
  if (firstDot >= 0) {
    cleaned = cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, "");
  }
  return cleaned;
}

export function ForeignMoneyInput({
  amount,
  onAmountChange,
  currency,
  onCurrencyChange,
  rate,
  onRateChange,
  className,
  tripDefaultCurrency,
}: ForeignMoneyInputProps) {
  const numAmount = parseFloat(amount);
  const numRate = parseFloat(rate);
  const estimateJpy =
    Number.isFinite(numAmount) && Number.isFinite(numRate) && numAmount > 0 && numRate > 0
      ? Math.round(numAmount * numRate)
      : null;
  const cur = getCurrency(currency);

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex gap-2">
        <input
          type="text"
          inputMode="decimal"
          autoComplete="off"
          enterKeyHint="next"
          placeholder="0"
          className="input text-2xl text-right font-semibold flex-1"
          value={amount}
          onChange={(e) => onAmountChange(sanitizeDecimal(e.target.value))}
        />
        <select
          className="input w-24 text-sm"
          value={currency}
          onChange={(e) => onCurrencyChange(e.target.value)}
          aria-label="通貨"
        >
          {/* Surface the trip's default at the top for fast tap, then the rest. */}
          {tripDefaultCurrency && !CURRENCIES.some((c) => c.code === tripDefaultCurrency) && (
            <option value={tripDefaultCurrency}>{tripDefaultCurrency}</option>
          )}
          {CURRENCIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.code} — {c.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>💱 レート</span>
        <input
          type="text"
          inputMode="decimal"
          className="input h-7 text-xs w-24 text-right"
          value={rate}
          onChange={(e) => onRateChange(sanitizeDecimal(e.target.value))}
          aria-label={`${cur.code} 1単位あたりの円レート`}
        />
        <span>¥/{cur.code}</span>
      </div>

      <div className="text-sm">
        {estimateJpy != null ? (
          <span>
            <span className="text-muted-foreground">→ 見積り</span>{" "}
            <span className="font-semibold">¥{estimateJpy.toLocaleString("ja-JP")}</span>{" "}
            <span className="chip text-[10px] px-1.5 py-0 bg-amber-500/15 text-amber-700 border border-amber-500/30">
              未確定
            </span>
          </span>
        ) : (
          <span className="text-muted-foreground">→ 金額とレートを入力すると見積りが表示されます</span>
        )}
        {estimateJpy != null && numAmount > 0 && (
          <div className="text-[11px] text-muted-foreground mt-0.5">
            原価: {formatForeign(numAmount, cur.code)}
          </div>
        )}
      </div>
    </div>
  );
}
