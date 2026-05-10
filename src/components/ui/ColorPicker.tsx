"use client";

import * as React from "react";
import { COLOR_PALETTE } from "@/lib/colorPalette";
import { cn } from "@/lib/utils";

type ColorPickerProps = {
  /** Current hex value, or null to use the system default. */
  value: string | null;
  /** Called with a hex string when a swatch is chosen, or null when "default" is selected. */
  onChange: (next: string | null) => void;
  /** Optional small label rendered above the grid. */
  label?: string;
  /** Visually-hidden label for screen readers when no `label` is shown. */
  ariaLabel?: string;
  className?: string;
};

/**
 * 24-swatch grid + "default" reset. Selecting a swatch immediately calls
 * onChange — keep persistence side-effects in the parent.
 */
export function ColorPicker({ value, onChange, label, ariaLabel = "色を選ぶ", className }: ColorPickerProps) {
  const normalized = value?.toLowerCase() ?? null;
  return (
    <div className={cn("space-y-1.5", className)}>
      {label && <div className="text-xs text-muted-foreground">{label}</div>}
      <div role="radiogroup" aria-label={ariaLabel} className="flex flex-wrap gap-1.5">
        <button
          type="button"
          role="radio"
          aria-checked={normalized === null}
          onClick={() => onChange(null)}
          className={cn(
            "h-7 w-7 rounded-full border bg-card text-[10px] text-muted-foreground inline-flex items-center justify-center",
            "hover:border-foreground/40 transition-colors",
            normalized === null
              ? "ring-2 ring-foreground/40 border-foreground/60"
              : "border-border",
          )}
          title="デフォルト"
        >
          ✕
        </button>
        {COLOR_PALETTE.map((c) => {
          const active = normalized === c.hex.toLowerCase();
          return (
            <button
              key={c.hex}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(c.hex)}
              className={cn(
                "h-7 w-7 rounded-full border-2 transition-transform",
                "hover:scale-110",
                active ? "ring-2 ring-foreground/40 border-foreground/40" : "border-transparent",
              )}
              style={{ backgroundColor: c.hex }}
              title={c.name}
            />
          );
        })}
      </div>
    </div>
  );
}
