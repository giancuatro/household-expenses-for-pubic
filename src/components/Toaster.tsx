"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  subscribeToasts,
  dismissToast,
  type ToastItem,
} from "@/lib/toast";

const VARIANT_STYLES: Record<ToastItem["variant"], string> = {
  default: "bg-popover text-popover-foreground border-border",
  success: "bg-popover text-popover-foreground border-success/40",
  error: "bg-popover text-popover-foreground border-destructive/40",
};

const VARIANT_ICON_COLOR: Record<ToastItem["variant"], string> = {
  default: "text-muted-foreground",
  success: "text-success",
  error: "text-destructive",
};

function VariantIcon({ variant }: { variant: ToastItem["variant"] }) {
  if (variant === "success")
    return <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />;
  if (variant === "error")
    return <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />;
  return <Info className="h-4 w-4 shrink-0" aria-hidden="true" />;
}

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    return subscribeToasts(setItems);
  }, []);

  if (items.length === 0) return null;

  return (
    <div
      role="region"
      aria-label="通知"
      className="fixed top-3 left-1/2 -translate-x-1/2 z-[60] flex flex-col gap-2 px-4 w-full max-w-sm pointer-events-none"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      {items.map((t) => (
        <div
          key={t.id}
          role={t.variant === "error" ? "alert" : "status"}
          className={cn(
            "pointer-events-auto rounded-xl border shadow-lg px-3 py-2.5 text-sm flex items-start gap-2",
            "animate-in fade-in slide-in-from-top-2 duration-200",
            VARIANT_STYLES[t.variant],
          )}
        >
          <span className={cn("mt-0.5", VARIANT_ICON_COLOR[t.variant])}>
            <VariantIcon variant={t.variant} />
          </span>
          <span className="flex-1 min-w-0 break-words">{t.message}</span>
          <button
            type="button"
            onClick={() => dismissToast(t.id)}
            className="text-muted-foreground hover:text-foreground transition-colors -mr-1 p-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="閉じる"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}
