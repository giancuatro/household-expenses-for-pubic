"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  CashBalanceSnapshotRow,
  CategoryRow,
  FixedCostMasterRow,
  InvestmentHoldingRow,
  InvestmentTransactionRow,
  PaymentMethodRow,
  TransactionRow,
  UserRow,
} from "@/lib/types";
import type { MonthlyRollupRow } from "@/lib/queries";
import type { ConfirmedBill } from "@/lib/cashFlow";
import { yen, monthKey, addMonths, yAxisUnit, makeTickFormatter } from "@/lib/format";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { buildCategoryColorMap, CATEGORY_PALETTE } from "@/lib/categoryColors";
import { useChartTheme } from "@/lib/chartTheme";
import clsx from "clsx";
import CardCfSummary from "./components/CardCfSummary";
import CashFlowProjection from "./components/CashFlowProjection";
import SpendPace from "./components/SpendPace";
import LargeSpendHighlights from "./components/LargeSpendHighlights";

// Asset-trend pulls its own recharts + price logic; defer it so it doesn't
// weigh down the dashboard's initial JS. Fixed-height placeholder avoids a
// layout shift while it streams in on the client.
const AssetTrendChart = dynamic(() => import("./components/AssetTrendChart"), {
  ssr: false,
  loading: () => (
    <section className="card">
      <div className="h-72 animate-pulse rounded bg-muted/40" />
    </section>
  ),
});

type Period = "3m" | "6m" | "1y" | "all";
const PERIODS: { key: Period; label: string }[] = [
  { key: "3m", label: "3ヶ月" },
  { key: "6m", label: "6ヶ月" },
  { key: "1y", label: "1年" },
  { key: "all", label: "全期間" },
];

/* --------- Donut custom label --------- */
const RADIAN = Math.PI / 180;
function renderDonutLabel({
  cx, cy, midAngle, innerRadius, outerRadius, percent,
}: { cx: number; cy: number; midAngle: number; innerRadius: number; outerRadius: number; percent: number }) {
  const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  if (percent < 0.04) return null;
  return (
    <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight={600}>
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  );
}

/* ================================================================ */
export default function DashboardClient({
  users,
  categories,
  windowTransactions,
  rollup,
  paymentMethods,
  cashSnapshots,
  fixedCostMasters,
  confirmedBills,
  holdings,
  trades,
  initialPrices,
  pendingFxSummary,
}: {
  users: UserRow[];
  categories: CategoryRow[];
  /** Recent-window rows (≈anchor−70d) for the cash-flow / current-cycle widgets. */
  windowTransactions: TransactionRow[];
  /** DB-side monthly rollup driving the full-history charts. */
  rollup: MonthlyRollupRow[];
  paymentMethods: PaymentMethodRow[];
  cashSnapshots: CashBalanceSnapshotRow[];
  fixedCostMasters: FixedCostMasterRow[];
  confirmedBills: ConfirmedBill[];
  holdings: InvestmentHoldingRow[];
  trades: InvestmentTransactionRow[];
  initialPrices?: Record<string, { price: number; priceUnit: number }>;
  pendingFxSummary?: { count: number; totalEstimateJpy: number };
}) {
  const [period, setPeriod] = useState<Period>("3m");
  const [hiddenStackCats, setHiddenStackCats] = useState<Set<string>>(new Set());
  const theme = useChartTheme();
  const ASSET_COLORS = theme.palette;

  /* ------------- Category colors ------------- */
  const colorMap = useMemo(() => buildCategoryColorMap(categories), [categories]);

  /* ------------- Aggregate transaction data (accrual / 20-day cycle) ------------- */
  const { monthly, stacked, donutData, heatmap, cats } = useMemo(() => {
    const ms = new Set<string>();
    const byMonth = new Map<string, { income: number; expense: number; net: number }>();
    const byMonthCat = new Map<string, Map<string, number>>();
    const byCat = new Map<string, number>();

    // Advances are already excluded server-side; transfers are filtered here to
    // keep the original chart semantics (net income/expense, category totals).
    for (const r of rollup) {
      if (r.category_type === "transfer_in" || r.category_type === "transfer_out") continue;
      const ym = r.ym;
      ms.add(ym);
      const mm = byMonth.get(ym) ?? { income: 0, expense: 0, net: 0 };
      if (r.category_type === "income") mm.income += r.total;
      else if (["fixed", "loan", "variable", "personal", "special"].includes(r.category_type))
        mm.expense += r.total;
      mm.net = mm.income - mm.expense;
      byMonth.set(ym, mm);

      if (r.category_id) {
        const cm = byMonthCat.get(ym) ?? new Map<string, number>();
        cm.set(r.category_id, (cm.get(r.category_id) ?? 0) + r.total);
        byMonthCat.set(ym, cm);
        byCat.set(r.category_id, (byCat.get(r.category_id) ?? 0) + r.total);
      }
    }

    const sortedMonths = Array.from(ms).sort();
    const monthly = sortedMonths.map((m) => ({ month: m, ...byMonth.get(m)! }));

    const activeCats = categories.filter((c) => c.is_active);
    const stacked = sortedMonths.map((m) => {
      const cm = byMonthCat.get(m) ?? new Map();
      const row: Record<string, number | string> = { month: m };
      for (const c of activeCats) row[c.name] = cm.get(c.id) ?? 0;
      return row;
    });

    const donutData = activeCats
      .map((c) => ({ name: c.name, value: byCat.get(c.id) ?? 0, id: c.id }))
      .filter((d) => d.value > 0);

    const heatmap = sortedMonths.map((m) => {
      const cm = byMonthCat.get(m) ?? new Map<string, number>();
      return {
        month: m,
        cells: activeCats.map((c) => {
          const spent = cm.get(c.id) ?? 0;
          const ratio = c.budget_amount > 0 ? spent / c.budget_amount : 0;
          return { cat: c.name, ratio, spent, budget: c.budget_amount };
        }),
      };
    });

    return { monthly, stacked, donutData, heatmap, months: sortedMonths, cats: activeCats };
  }, [rollup, categories]);

  /* ------------- Period-filtered slices ------------- */
  const filteredMonths = useMemo(() => {
    if (period === "all") return monthly.map((m) => m.month);
    const n = period === "3m" ? 3 : period === "6m" ? 6 : 12;
    const recent: string[] = [];
    const currentYM = monthKey();
    for (let i = n - 1; i >= 0; i--) recent.push(addMonths(currentYM, -i));
    const allMonths = monthly.map((m) => m.month);
    return recent.filter((ym) => allMonths.includes(ym));
  }, [period, monthly]);

  const fMonthly = monthly.filter((m) => filteredMonths.includes(m.month));
  const fStacked = stacked.filter((s) => filteredMonths.includes(s.month as string));

  const dataLen = fMonthly.length;
  const chartMinW = Math.max(300, dataLen * 60);
  const barSize = Math.min(40, Math.max(8, Math.floor(200 / dataLen)));

  const maxPrimaryVal = fMonthly.reduce((mx, m) => Math.max(mx, m.income, m.expense, Math.abs(m.net)), 0);
  const mainUnit = yAxisUnit(maxPrimaryVal);

  const maxStackedVal = fStacked.reduce((mx, row) => {
    let sum = 0;
    for (const c of cats) sum += (row[c.name] as number) || 0;
    return Math.max(mx, sum);
  }, 0);
  const stackUnit = yAxisUnit(maxStackedVal);
  const heatmapSlice = heatmap.slice(-6);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">分析</h1>

      {pendingFxSummary && pendingFxSummary.count > 0 && (
        <a
          href="/reconcile"
          className="card flex items-center justify-between gap-3 border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/15 transition-colors"
        >
          <div>
            <div className="text-sm font-semibold text-amber-700 dark:text-amber-400">
              ✈️ 未確定 FX 取引: {pendingFxSummary.count}件（見積り {yen(pendingFxSummary.totalEstimateJpy)}）
            </div>
            <div className="text-xs text-amber-700/80 dark:text-amber-400/80 mt-0.5">
              カード明細をインポートすると、レートと円額が自動で確定されます。
            </div>
          </div>
          <span className="text-amber-700 dark:text-amber-400 shrink-0">→</span>
        </a>
      )}

      <Tabs defaultValue="overview">
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="overview" className="flex-1 sm:flex-none">概況</TabsTrigger>
          <TabsTrigger value="spending" className="flex-1 sm:flex-none">支出分析</TabsTrigger>
          <TabsTrigger value="assets" className="flex-1 sm:flex-none">資産</TabsTrigger>
        </TabsList>

        {/* ============ 概況 ============ */}
        <TabsContent value="overview" className="space-y-6">
          {/* Cash flow projection (next 60 days) */}
          <CashFlowProjection
            snapshots={cashSnapshots}
            transactions={windowTransactions}
            paymentMethods={paymentMethods}
            fixedCostMasters={fixedCostMasters}
            confirmedBills={confirmedBills}
          />
          {/* Card CF summary */}
          <CardCfSummary
            users={users}
            transactions={windowTransactions}
            paymentMethods={paymentMethods}
          />
          {/* Spend pace (current cycle) */}
          <SpendPace transactions={windowTransactions} categories={categories} currentMonth={monthKey()} />
        </TabsContent>

        {/* ============ 支出分析 ============ */}
        <TabsContent value="spending" className="space-y-6">
      {/* ============ Period filter (applies to charts below) ============ */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-2 flex-wrap">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              className={clsx(
                "chip border text-sm",
                period === p.key ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border"
              )}
              onClick={() => setPeriod(p.key)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* ============ Monthly income/expense chart ============ */}
      <section className="card">
        <h2 className="font-semibold mb-1">月別 収入・支出・収支</h2>
        <div className="text-xs text-muted-foreground mb-3 flex flex-wrap gap-x-3 gap-y-1">
          <span>
            <span className="font-semibold">{mainUnit.label}</span>:{" "}
            <span style={{ color: theme.income }}>収入</span>
            <span className="mx-1">/</span>
            <span style={{ color: theme.expense }}>支出</span>
            <span className="mx-1">/</span>
            <span style={{ color: theme.net }}>収支</span>
          </span>
          <span>(20日締めサイクル・利用日ベース)</span>
        </div>
        <div className="overflow-x-auto">
          <div style={{ minWidth: chartMinW, height: 288 }}>
            <ResponsiveContainer>
              {period === "all" ? (
                <LineChart data={fMonthly} margin={{ top: 28, right: 16, bottom: 5, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={theme.grid} />
                  <XAxis dataKey="month" fontSize={12} />
                  <YAxis tickFormatter={makeTickFormatter(mainUnit.divisor)} fontSize={12} width={48} label={{ value: mainUnit.label, position: "top", offset: 12, fontSize: 11, fill: theme.tooltipText }} />
                  <Tooltip contentStyle={{ backgroundColor: theme.tooltipBg, border: `1px solid ${theme.tooltipBorder}`, borderRadius: 8 }} labelStyle={{ color: theme.tooltipText, fontWeight: 600 }} itemStyle={{ color: theme.tooltipText }} formatter={(v: number) => yen(v)} />
                  <Legend />
                  <Line type="monotone" dataKey="income" name="収入" stroke={theme.income} strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="expense" name="支出" stroke={theme.expense} strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="net" name="収支" stroke={theme.net} strokeWidth={2} dot={false} />
                </LineChart>
              ) : (
                <ComposedChart data={fMonthly} barSize={barSize} margin={{ top: 28, right: 16, bottom: 5, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={theme.grid} />
                  <XAxis dataKey="month" fontSize={12} />
                  <YAxis tickFormatter={makeTickFormatter(mainUnit.divisor)} fontSize={12} width={48} label={{ value: mainUnit.label, position: "top", offset: 12, fontSize: 11, fill: theme.tooltipText }} />
                  <Tooltip contentStyle={{ backgroundColor: theme.tooltipBg, border: `1px solid ${theme.tooltipBorder}`, borderRadius: 8 }} labelStyle={{ color: theme.tooltipText, fontWeight: 600 }} itemStyle={{ color: theme.tooltipText }} formatter={(v: number) => yen(v)} />
                  <Legend />
                  <Bar dataKey="income" name="収入" fill={theme.income} />
                  <Bar dataKey="expense" name="支出" fill={theme.expense} />
                  <Line type="monotone" dataKey="net" name="収支" stroke={theme.net} strokeWidth={2} />
                </ComposedChart>
              )}
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      {/* ============ Stacked category chart ============ */}
      <section className="card">
        <h2 className="font-semibold mb-1">カテゴリ別 月次推移</h2>
        <p className="text-xs text-muted-foreground mb-2">
          単位 {stackUnit.label} ・ 凡例をクリックで該当カテゴリの表示/非表示
        </p>
        <div className="flex flex-wrap gap-1 mb-2">
          <button
            type="button"
            className="chip border text-[11px] bg-card border-border"
            onClick={() => setHiddenStackCats(new Set())}
          >全て表示</button>
          <button
            type="button"
            className="chip border text-[11px] bg-card border-border"
            onClick={() => setHiddenStackCats(new Set(cats.map((c) => c.name)))}
          >全て非表示</button>
        </div>
        <div className="overflow-x-auto">
          <div style={{ minWidth: chartMinW, height: 288 }}>
            <ResponsiveContainer>
              <BarChart data={fStacked} margin={{ top: 28, right: 16, bottom: 5, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={theme.grid} />
                <XAxis dataKey="month" fontSize={12} />
                <YAxis
                  tickFormatter={makeTickFormatter(stackUnit.divisor)}
                  fontSize={12}
                  width={48}
                  label={{ value: stackUnit.label, position: "top", offset: 12, fontSize: 11, fill: theme.tooltipText }}
                />
                <Tooltip contentStyle={{ backgroundColor: theme.tooltipBg, border: `1px solid ${theme.tooltipBorder}`, borderRadius: 8 }} labelStyle={{ color: theme.tooltipText, fontWeight: 600 }} itemStyle={{ color: theme.tooltipText }} formatter={(v: number) => yen(v)} />
                <Legend
                  onClick={(o) => {
                    const key = (o as { dataKey?: string; value?: string }).dataKey ?? (o as { value?: string }).value;
                    if (!key) return;
                    setHiddenStackCats((prev) => {
                      const next = new Set(prev);
                      if (next.has(key)) next.delete(key);
                      else next.add(key);
                      return next;
                    });
                  }}
                  formatter={(value) => {
                    const hidden = typeof value === "string" && hiddenStackCats.has(value);
                    return (
                      <span style={{ opacity: hidden ? 0.4 : 1, textDecoration: hidden ? "line-through" : undefined, cursor: "pointer" }}>
                        {value}
                      </span>
                    );
                  }}
                />
                {cats.map((c) => (
                  <Bar
                    key={c.id}
                    dataKey={c.name}
                    stackId="a"
                    fill={colorMap.get(c.id)?.chart ?? CATEGORY_PALETTE[0]}
                    hide={hiddenStackCats.has(c.name)}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      {/* ============ Donut + Heatmap ============ */}
      <section className="grid md:grid-cols-2 gap-4">
        <div className="card">
          <h2 className="font-semibold mb-3">カテゴリ別 支出割合</h2>
          <div className="h-72">
            <ResponsiveContainer>
              <PieChart>
                <Pie data={donutData} dataKey="value" nameKey="name" innerRadius={50} outerRadius={100} label={renderDonutLabel} labelLine={false}>
                  {donutData.map((d) => (
                    <Cell key={d.id} fill={colorMap.get(d.id)?.chart ?? CATEGORY_PALETTE[0]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ backgroundColor: theme.tooltipBg, border: `1px solid ${theme.tooltipBorder}`, borderRadius: 8 }} labelStyle={{ color: theme.tooltipText, fontWeight: 600 }} itemStyle={{ color: theme.tooltipText }} formatter={(v: number) => yen(v)} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card overflow-x-auto">
          <h2 className="font-semibold mb-3">予算達成率ヒートマップ（直近6ヶ月）</h2>
          <table className="text-xs w-full">
            <thead>
              <tr>
                <th className="p-1 text-left sticky left-0 bg-card z-10">月</th>
                {cats.map((c) => (
                  <th key={c.id} className="p-1 text-xs whitespace-nowrap text-center" style={{ minWidth: 44 }}>
                    {c.name.length > 5 ? c.name.slice(0, 5) + "…" : c.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {heatmapSlice.map((row) => (
                <tr key={row.month}>
                  <td className="p-1 sticky left-0 bg-card z-10 whitespace-nowrap">{row.month}</td>
                  {row.cells.map((cell, i) => {
                    const r = cell.ratio;
                    const color =
                      r === 0
                        ? "hsl(var(--muted))"
                        : r < 0.5
                          ? "hsl(var(--success) / 0.20)"
                          : r < 0.8
                            ? "hsl(var(--warning) / 0.30)"
                            : r <= 1
                              ? "hsl(var(--warning) / 0.55)"
                              : "hsl(var(--destructive) / 0.40)";
                    return (
                      <td key={i} className="p-1 text-center" style={{ background: color }}
                        title={`${cell.cat}: ${yen(cell.spent)} / ${yen(cell.budget)}`}>
                        {r > 0 ? `${Math.round(r * 100)}%` : "-"}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {fMonthly.length === 0 && (
        <div className="card text-sm text-muted-foreground text-center py-8">まだデータがありません。</div>
      )}
        </TabsContent>

        {/* ============ 資産 ============ */}
        <TabsContent value="assets" className="space-y-6">
          <AssetTrendChart holdings={holdings} trades={trades} initialPrices={initialPrices} />
          <LargeSpendHighlights users={users} categories={categories} transactions={windowTransactions} currentMonth={monthKey()} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

