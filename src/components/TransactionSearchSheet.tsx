"use client";

import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetBody, SheetTitle } from "@/components/ui/sheet";
import { searchTransactions } from "@/app/actions/transactions";
import { yen, formatJaDate } from "@/lib/format";
import type { CategoryRow, TransactionRow, UserRow } from "@/lib/types";

/**
 * Search icon + sheet for free-text lookup over note/subcategory across the
 * last 24 months. Debounced; results are read-only (tap-through to edit is out
 * of scope). Self-contained so the home page just drops it in the toolbar.
 */
export function TransactionSearchSheet({
  users,
  categories,
}: {
  users: UserRow[];
  categories: CategoryRow[];
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TransactionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const userName = useMemo(() => new Map(users.map((u) => [u.id, u.name])), [users]);
  const catName = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);

  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 1) {
      setResults([]);
      setSearched(false);
      return;
    }
    setLoading(true);
    const id = setTimeout(async () => {
      try {
        const rows = await searchTransactions(q);
        setResults(rows);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
        setSearched(true);
      }
    }, 300);
    return () => clearTimeout(id);
  }, [query, open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="取引を検索"
        className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-foreground hover:bg-accent transition-colors"
      >
        <Search className="h-3.5 w-3.5" aria-hidden="true" />
        <span>検索</span>
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="max-h-[85vh] flex flex-col">
          <SheetHeader>
            <SheetTitle>取引を検索</SheetTitle>
          </SheetHeader>
          <SheetBody className="space-y-3">
            <input
              className="input"
              placeholder="店名・メモ・カテゴリ名（直近24ヶ月）"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
            {loading && <p className="text-sm text-muted-foreground">検索中…</p>}
            {!loading && searched && results.length === 0 && (
              <p className="text-sm text-muted-foreground py-4 text-center">一致する取引がありません</p>
            )}
            {results.length > 0 && (
              <ul className="divide-y divide-border">
                {results.map((t) => {
                  const label = t.subcategory || (t.category_id ? catName.get(t.category_id) : null) || t.note || "—";
                  const sign = t.category_type === "income" ? "+" : "-";
                  return (
                    <li key={t.id} className="py-2 flex items-baseline gap-2 text-sm">
                      <span className="text-xs text-muted-foreground tabular-nums shrink-0 w-20">{formatJaDate(t.date)}</span>
                      <span className="flex-1 min-w-0">
                        <span className="truncate block">{label}</span>
                        {t.note && t.note !== label && (
                          <span className="text-xs text-muted-foreground truncate block">{t.note}</span>
                        )}
                      </span>
                      <span className="text-[10px] text-muted-foreground shrink-0">{userName.get(t.user_id) ?? ""}</span>
                      <span className="font-semibold tabular-nums shrink-0">
                        {sign}{yen(t.amount).replace("-", "")}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </SheetBody>
        </SheetContent>
      </Sheet>
    </>
  );
}
