"use client";

import * as React from "react";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";

type InfoTipProps = {
  /** Text or rich content shown when the tip is open. */
  children: React.ReactNode;
  /** Visually hidden label for screen readers (defaults to "ヘルプ"). */
  ariaLabel?: string;
  /** Tailwind classes for the wrapper span. */
  className?: string;
  /** Where the popover appears relative to the icon. Default: "top". */
  side?: "top" | "bottom";
  /** Override icon size in pixels. Default: 14. */
  size?: number;
};

/**
 * A small "i" icon button that reveals a tooltip-style popover when tapped or
 * focused. Click-outside or Escape closes it. Use to replace long inline help
 * text — keep the visible UI compact and let users opt in to detail.
 */
export function InfoTip({ children, ariaLabel = "ヘルプ", className, side = "top", size = 14 }: InfoTipProps) {
  const [open, setOpen] = React.useState(false);
  const wrapperRef = React.useRef<HTMLSpanElement>(null);

  React.useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <span ref={wrapperRef} className={cn("relative inline-flex align-middle", className)}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className={cn(
          "inline-flex items-center justify-center rounded-full text-muted-foreground",
          "hover:text-foreground transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        <Info width={size} height={size} aria-hidden="true" />
      </button>
      {open && (
        <span
          role="tooltip"
          className={cn(
            "absolute z-50 left-1/2 -translate-x-1/2 w-64 max-w-[80vw]",
            "rounded-lg border border-border bg-popover text-popover-foreground shadow-lg",
            "px-3 py-2 text-xs leading-relaxed text-left",
            side === "top" ? "bottom-full mb-2" : "top-full mt-2",
          )}
        >
          {children}
        </span>
      )}
    </span>
  );
}
