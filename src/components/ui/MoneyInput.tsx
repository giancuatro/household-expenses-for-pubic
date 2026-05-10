"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export type MoneyInputProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "type" | "inputMode" | "pattern"
> & {
  /** Raw digits-only string, e.g. "1000". Empty string for blank. */
  value: string;
  /** Called with the raw digits-only string. Drop-in for `setState(e.target.value)`. */
  onChange: (next: string) => void;
  /** Allow negative values. Default: false. */
  allowNegative?: boolean;
};

function formatWithCommas(raw: string): string {
  if (raw === "" || raw === "-") return raw;
  const negative = raw.startsWith("-");
  const digits = negative ? raw.slice(1) : raw;
  if (digits === "") return raw;
  const n = Number(digits);
  if (Number.isNaN(n)) return raw;
  return (negative ? "-" : "") + n.toLocaleString("ja-JP");
}

/**
 * Numeric input that auto-inserts thousands separators (ja-JP) as the user
 * types. Stores the raw digits-only string, displays the comma-formatted view.
 *
 * Drop-in replacement for `<input type="number" value={s} onChange={e => set(e.target.value)} />`.
 */
export const MoneyInput = React.forwardRef<HTMLInputElement, MoneyInputProps>(
  ({ value, onChange, allowNegative = false, className, ...rest }, ref) => {
    function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
      const raw = e.target.value;
      // Strip everything except digits (and optional leading minus when allowed).
      let sanitized = raw.replace(/[^\d-]/g, "");
      if (allowNegative) {
        const negative = sanitized.startsWith("-");
        sanitized = (negative ? "-" : "") + sanitized.replace(/-/g, "");
      } else {
        sanitized = sanitized.replace(/-/g, "");
      }
      onChange(sanitized);
    }

    return (
      <input
        ref={ref}
        {...rest}
        type="text"
        inputMode="numeric"
        pattern="[0-9,\\-]*"
        autoComplete="off"
        value={formatWithCommas(value)}
        onChange={handleChange}
        className={cn("input", className)}
      />
    );
  },
);
MoneyInput.displayName = "MoneyInput";
