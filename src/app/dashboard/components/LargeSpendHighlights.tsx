"use client";

import { useMemo } from "react";
import type { CategoryRow, TransactionRow, UserRow } from "@/lib/types";
import { yen, formatJaDate, monthDateRange } from "@/lib/format";

/** Top-N largest non-income transactions in the current cycle. */
export default function LargeSpendHighlights({
  users,
  categories,
  transactions,
  currentMonth,
  limit = 5,
}: {
  users: UserRow[];
  categories: CategoryRow[];
  transactions: TransactionRow[];
  currentMonth: string;
  limit?: number;
}) {
  const userById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  const items = useMemo(() => {
    const { start, end } = monthDateRange(currentMonth);
    const exclude = new Set(["income", "transfer_in", "transfer_out"]);
    return transactions
      .filter((t) => !exclude.has(t.category_type) && t.date >= start && t.date <= end)
      .sort((a, b) => b.amount - a.amount)
      .slice(0, limit);
  }, [transactions, currentMonth, limit]);

  if (items.length === 0) return null;

  return (
    <section className="card">
      <h2 className="font-semibold mb-1">今月の大きな支出 トップ{limit}</h2>
      <p className="text-xs text-muted-foreground mb-3">高額な支出の確認用。立替や個人支出も含みます。</p>
      <ul className="divide-y divide-border">
        {items.map((t) => {
          const user = userById.get(t.user_id)?.name ?? "—";
          const cat = t.category_id ? catById.get(t.category_id)?.name : null;
          const labelMap: Record<string, string> = {
            fixed: "固定費",
            loan: "ローン",
            variable: "変動",
            personal: "個人",
            investment: "投資",
            special: "特別",
          };
          const kindLabel = labelMap[t.category_type] ?? t.category_type;
          return (
            <li key={t.id} className="py-2 flex items-center gap-2 min-w-0">
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{cat ?? kindLabel}{t.subcategory ? ` / ${t.subcategory}` : ""}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {formatJaDate(t.date)} · {user}
                  {t.note && ` · ${t.note}`}
                </div>
              </div>
              <div className="font-bold tabular-nums shrink-0">{yen(t.amount)}</div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
