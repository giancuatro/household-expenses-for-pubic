"use client";

import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetBody,
} from "@/components/ui/sheet";

type Props = {
  title?: string;
  lines: { label: string; value: string }[];
  total?: { label: string; value: string };
};

export default function InfoTip({ title, lines, total }: Props) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <button
          type="button"
          aria-label="内訳を表示"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center justify-center w-4 h-4 ml-1 align-middle rounded-full border border-input text-[10px] text-muted-foreground hover:bg-muted leading-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          i
        </button>
      </SheetTrigger>
      <SheetContent side="bottom" className="max-h-[80vh] flex flex-col">
        <SheetHeader>
          <SheetTitle>{title ?? "内訳"}</SheetTitle>
        </SheetHeader>
        <SheetBody className="flex-1">
          <div
            className="grid gap-2"
            style={{
              gridTemplateColumns: `repeat(${Math.max(1, lines.length)}, minmax(0, 1fr))`,
            }}
          >
            {lines.map((l, i) => (
              <div key={i} className="rounded-lg bg-muted/50 px-2 py-2 text-center min-w-0">
                <div className="text-[11px] text-muted-foreground leading-tight break-words">
                  {l.label}
                </div>
                <div className="text-sm font-semibold mt-1 break-all tabular-nums">
                  {l.value}
                </div>
              </div>
            ))}
          </div>
          {total && (
            <div className="mt-3 pt-3 border-t border-border flex items-baseline justify-between">
              <span className="text-sm font-semibold">{total.label}</span>
              <span className="text-base font-bold tabular-nums">{total.value}</span>
            </div>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
