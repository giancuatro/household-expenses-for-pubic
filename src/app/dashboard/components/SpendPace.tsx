"use client";

import { useMemo } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { CategoryRow, TransactionRow } from "@/lib/types";
import { yen, monthDateRange, yAxisUnit, makeTickFormatter } from "@/lib/format";
import { useChartTheme } from "@/lib/chartTheme";

/**
 * Cumulative shared variable spend across the current cycle, vs the cycle's
 * combined budget. Lets you see whether the month is tracking ahead or behind
 * plan.
 */
export default function SpendPace({
  transactions,
  categories,
  currentMonth,
}: {
  transactions: TransactionRow[];
  categories: CategoryRow[];
  currentMonth: string; // YYYY-MM
}) {
  const theme = useChartTheme();

  const data = useMemo(() => {
    const { start, end } = monthDateRange(currentMonth);
    // Sum daily shared variable expenses (the budgeted bucket).
    const sharedActive = categories.filter(
      (c) => c.is_active && c.type === "shared" && c.budget_amount > 0
    );
    const budgetTotal = sharedActive.reduce((a, c) => a + c.budget_amount, 0);
    const validIds = new Set(sharedActive.map((c) => c.id));

    const dailySpend = new Map<string, number>();
    for (const t of transactions) {
      if (t.category_type !== "variable") continue;
      if (!t.category_id || !validIds.has(t.category_id)) continue;
      if (t.is_advance_payment) continue;
      if (t.date < start || t.date > end) continue;
      dailySpend.set(t.date, (dailySpend.get(t.date) ?? 0) + t.amount);
    }

    const days: { date: string; cumulative: number; budget: number }[] = [];
    const startDate = new Date(start + "T00:00:00");
    const endDate = new Date(end + "T00:00:00");
    let running = 0;
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      running += dailySpend.get(iso) ?? 0;
      days.push({ date: iso, cumulative: running, budget: budgetTotal });
    }
    return { days, budgetTotal, start, end };
  }, [transactions, categories, currentMonth]);

  const today = new Date().toISOString().slice(0, 10);
  const todayIdx = data.days.findIndex((d) => d.date === today);
  // After today, freeze the cumulative line so it doesn't read as a forecast.
  const trimmed = todayIdx >= 0 ? data.days.slice(0, todayIdx + 1) : data.days;
  const final = trimmed.length > 0 ? trimmed[trimmed.length - 1] : null;
  const onTrack = final ? final.cumulative <= data.budgetTotal : true;

  const maxValAll = data.days.reduce((mx, d) => Math.max(mx, d.cumulative, d.budget), 0);
  const unit = yAxisUnit(maxValAll);

  if (data.budgetTotal === 0 || data.days.length === 0) return null;

  return (
    <section className="card">
      <h2 className="font-semibold mb-1">今月の支出ペース</h2>
      <p className="text-xs text-muted-foreground mb-3">
        共有・変動カテゴリの累計支出 vs 月予算 ({yen(data.budgetTotal)}) — 単位 {unit.label}
        {final && (
          <span className={`ml-2 ${onTrack ? "text-success" : "text-destructive"}`}>
            ・現在 {yen(final.cumulative)} ({Math.round((final.cumulative / data.budgetTotal) * 100)}%)
          </span>
        )}
      </p>
      <div style={{ width: "100%", height: 240 }}>
        <ResponsiveContainer>
          <LineChart data={trimmed} margin={{ top: 28, right: 20, bottom: 5, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={theme.grid} />
            <XAxis
              dataKey="date"
              fontSize={12}
              interval={Math.max(0, Math.floor(trimmed.length / 6))}
              tickFormatter={(v: string) => v.slice(5)}
            />
            <YAxis
              tickFormatter={makeTickFormatter(unit.divisor)}
              fontSize={12}
              width={48}
              label={{ value: unit.label, position: "top", offset: 12, fontSize: 11, fill: theme.tooltipText }}
            />
            <Tooltip
              contentStyle={{ backgroundColor: theme.tooltipBg, border: `1px solid ${theme.tooltipBorder}`, borderRadius: 8 }}
              labelStyle={{ color: theme.tooltipText, fontWeight: 600 }}
              itemStyle={{ color: theme.tooltipText }}
              formatter={(v: number) => yen(v)}
            />
            <ReferenceLine y={data.budgetTotal} stroke={theme.expense} strokeDasharray="4 4" label={{ value: "予算", fill: theme.expense, fontSize: 10, position: "right" }} />
            <Line type="monotone" dataKey="cumulative" name="累計支出" stroke={theme.net} strokeWidth={2.5} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
