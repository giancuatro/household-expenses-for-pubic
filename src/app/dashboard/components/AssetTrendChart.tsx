"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import clsx from "clsx";
import type { InvestmentHoldingRow, InvestmentTransactionRow } from "@/lib/types";
import { yen, todayIso, yAxisUnit, makeTickFormatter } from "@/lib/format";
import { useChartTheme } from "@/lib/chartTheme";
import {
  buildAssetHistory,
  type AssetSeriesRow,
  type Granularity,
  type TickerMeta,
} from "@/lib/assetHistory";

type AssetPeriod = "1w" | "1m" | "3m" | "6m" | "ytd" | "all";
type ChartMode = "area" | "line";

const PERIOD_BUTTONS: { key: AssetPeriod; label: string }[] = [
  { key: "1w", label: "1週間" },
  { key: "1m", label: "1ヶ月" },
  { key: "3m", label: "3ヶ月" },
  { key: "6m", label: "6ヶ月" },
  { key: "ytd", label: "年初来" },
  { key: "all", label: "全期間" },
];

/** Days approximately covered by each period — used to gate daily granularity. */
function daysFor(period: AssetPeriod): number {
  if (period === "1w") return 7;
  if (period === "1m") return 31;
  if (period === "3m") return 92;
  if (period === "6m") return 184;
  if (period === "ytd") {
    const now = new Date();
    const yearStart = new Date(now.getFullYear(), 0, 1);
    return Math.ceil((now.getTime() - yearStart.getTime()) / 86_400_000);
  }
  return 9999;
}

/** Daily granularity is allowed up to ~1 year; beyond that we switch to monthly. */
function granularityAllowed(period: AssetPeriod, g: Granularity): boolean {
  if (g === "monthly") return true;
  return daysFor(period) <= 380;
}

function startDateForPeriod(period: AssetPeriod): string | undefined {
  const now = new Date();
  if (period === "all") return undefined;
  if (period === "ytd") {
    const y = now.getFullYear();
    return `${y}-01-01`;
  }
  const days = daysFor(period);
  const d = new Date(now.getTime() - days * 86_400_000);
  return iso(d);
}

function iso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function AssetTrendChart({
  holdings,
  trades,
}: {
  holdings: InvestmentHoldingRow[];
  trades: InvestmentTransactionRow[];
}) {
  const theme = useChartTheme();
  const ASSET_COLORS = theme.palette;
  const [rows, setRows] = useState<AssetSeriesRow[]>([]);
  const [tickers, setTickers] = useState<TickerMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<ChartMode>("line");
  const [period, setPeriod] = useState<AssetPeriod>("3m");
  // Default: only the total is visible. Per-ticker chips toggle individual lines.
  const [visibleTickers, setVisibleTickers] = useState<Set<string>>(new Set());

  // Daily by default; fall back to monthly only when period is too long for daily fetches.
  const effectiveGranularity: Granularity = granularityAllowed(period, "daily")
    ? "daily"
    : "monthly";

  useEffect(() => {
    let cancelled = false;
    if (holdings.length === 0 && trades.length === 0) {
      setRows([]);
      setTickers([]);
      return;
    }
    setLoading(true);
    // Fetch the live price for every ticker we may need, then pass it into
    // buildAssetHistory so the chart's right-most data point uses live prices
    // (matches the headline total on the investment tab). If a price fetch
    // fails the entry is just omitted — buildAssetHistory falls back to
    // history/snapshot in that case.
    const allTickers = Array.from(new Set([
      ...holdings.map((h) => h.ticker),
      ...trades.map((t) => t.ticker),
    ]));
    const fetchAll = Promise.all(
      allTickers.map(async (ticker) => {
        try {
          const res = await fetch(`/api/stock-price?ticker=${encodeURIComponent(ticker)}`);
          if (!res.ok) return [ticker, null] as const;
          const json: { price?: number; error?: string } = await res.json();
          if (json.error || typeof json.price !== "number") return [ticker, null] as const;
          return [ticker, json.price] as const;
        } catch {
          return [ticker, null] as const;
        }
      }),
    ).then((entries) => {
      const m = new Map<string, number>();
      for (const [t, p] of entries) if (p !== null) m.set(t, p);
      return m;
    });

    fetchAll
      .then((livePrices) =>
        buildAssetHistory({
          holdings,
          trades,
          granularity: effectiveGranularity,
          fromDate: startDateForPeriod(period),
          livePrices,
        }),
      )
      .then(({ rows, tickers }) => {
        if (cancelled) return;
        setRows(rows);
        setTickers(tickers);
      })
      .catch(() => {
        if (cancelled) return;
        setRows([]);
        setTickers([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [holdings, trades, effectiveGranularity, period]);

  const filtered = useMemo(() => {
    if (period === "all") return rows;
    const start = startDateForPeriod(period) ?? "";
    const today = todayIso();
    return rows.filter((r) => r.date >= start && r.date <= today);
  }, [rows, period]);

  // Dynamic Y-axis: zoom to the period's range with ~8% padding (line mode only).
  const totalsInRange = filtered.map((r) => r.total).filter((v) => v > 0);
  const minVal = totalsInRange.length > 0 ? Math.min(...totalsInRange) : 0;
  const maxVal = totalsInRange.length > 0 ? Math.max(...totalsInRange) : 0;
  const span = maxVal - minVal;
  const yPadding = span > 0 ? span * 0.08 : Math.max(maxVal * 0.05, 1);
  const yMax = Math.ceil(maxVal + yPadding);
  const yMinLine = Math.max(0, Math.floor(minVal - yPadding));
  const yMin = mode === "area" ? 0 : yMinLine;
  const unit = yAxisUnit(yMax);

  const latestTotal = filtered.length > 0 ? filtered[filtered.length - 1].total : 0;
  const earliestInRange = filtered.length > 0 ? filtered[0].total : 0;
  const rangeDelta = latestTotal - earliestInRange;
  const rangePctText =
    earliestInRange > 0
      ? ` (${rangeDelta >= 0 ? "+" : ""}${((rangeDelta / earliestInRange) * 100).toFixed(1)}%)`
      : "";

  if (holdings.length === 0 && trades.length === 0) return null;

  // Aim for roughly 6 X-axis labels regardless of how many points are plotted.
  const xTickInterval = filtered.length > 6 ? Math.max(0, Math.floor(filtered.length / 6)) : 0;
  const tickFmt = (v: string) => (v.length === 10 ? v.slice(5) : v);

  function toggleTicker(t: string) {
    setVisibleTickers((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  }

  return (
    <section className="card">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <h2 className="font-semibold">資産推移（評価額）</h2>
        <div className="flex items-center gap-2 flex-wrap">
          {loading && <span className="text-xs text-muted-foreground animate-pulse">取得中...</span>}
          <div className="flex gap-1">
            <button
              className={clsx(
                "chip border text-xs",
                mode === "line"
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card border-border"
              )}
              onClick={() => setMode("line")}
            >
              折れ線
            </button>
            <button
              className={clsx(
                "chip border text-xs",
                mode === "area"
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card border-border"
              )}
              onClick={() => setMode("area")}
            >
              積み上げ
            </button>
          </div>
        </div>
      </div>

      {/* Independent period buttons (do not affect other dashboard charts) */}
      <div className="flex flex-wrap gap-1 mb-3">
        {PERIOD_BUTTONS.map((p) => (
          <button
            key={p.key}
            className={clsx(
              "chip border text-xs",
              period === p.key ? "bg-foreground text-background border-foreground" : "bg-card border-border"
            )}
            onClick={() => setPeriod(p.key)}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="text-xs text-muted-foreground mb-3">
        単位 {unit.label} ・{" "}
        {effectiveGranularity === "monthly"
          ? "各月末の終値で評価（保有数量は当時の売買履歴から再現）。"
          : "各日の終値で評価（保有数量は当時の売買履歴から再現、休場日は直前終値を踏襲）。"}
        為替は現在レートで換算。
        {filtered.length > 1 && (
          <span className="ml-2">
            期間内推移: {yen(earliestInRange)} → {yen(latestTotal)}
            {rangePctText}
          </span>
        )}
      </div>

      {/* Per-ticker visibility chips (only relevant in line mode). */}
      {mode === "line" && tickers.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {tickers.map((t, i) => {
            const active = visibleTickers.has(t.ticker);
            const color = ASSET_COLORS[i % ASSET_COLORS.length];
            return (
              <button
                key={t.ticker}
                onClick={() => toggleTicker(t.ticker)}
                className={clsx("chip border text-[11px]", active ? "" : "bg-card border-border opacity-70")}
                style={
                  active
                    ? { backgroundColor: color, borderColor: color, color: "#fff" }
                    : undefined
                }
                title={active ? "クリックで非表示" : "クリックで表示"}
              >
                {t.name}
              </button>
            );
          })}
        </div>
      )}

      {filtered.length > 0 ? (
        <div style={{ width: "100%", height: 288 }}>
          <ResponsiveContainer>
            {mode === "area" ? (
              <AreaChart data={filtered} margin={{ top: 28, right: 16, bottom: 5, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={theme.grid} />
                <XAxis dataKey="date" fontSize={11} interval={xTickInterval} tickFormatter={tickFmt} />
                <YAxis
                  tickFormatter={makeTickFormatter(unit.divisor)}
                  fontSize={11}
                  width={48}
                  domain={[yMin, yMax]}
                  label={{ value: unit.label, position: "top", offset: 12, fontSize: 11, fill: theme.tooltipText }}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: theme.tooltipBg,
                    border: `1px solid ${theme.tooltipBorder}`,
                    borderRadius: 8,
                  }}
                  labelStyle={{ color: theme.tooltipText, fontWeight: 600 }}
                  itemStyle={{ color: theme.tooltipText }}
                  formatter={(v: number) => yen(v)}
                />
                {tickers.map((t, i) => (
                  <Area
                    key={t.ticker}
                    type="monotone"
                    dataKey={t.ticker}
                    name={t.name}
                    stackId="assets"
                    stroke={ASSET_COLORS[i % ASSET_COLORS.length]}
                    fill={ASSET_COLORS[i % ASSET_COLORS.length]}
                    fillOpacity={0.55}
                    isAnimationActive={false}
                  />
                ))}
              </AreaChart>
            ) : (
              <LineChart data={filtered} margin={{ top: 28, right: 16, bottom: 5, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={theme.grid} />
                <XAxis dataKey="date" fontSize={11} interval={xTickInterval} tickFormatter={tickFmt} />
                <YAxis
                  tickFormatter={makeTickFormatter(unit.divisor)}
                  fontSize={11}
                  width={48}
                  domain={[yMin, yMax]}
                  label={{ value: unit.label, position: "top", offset: 12, fontSize: 11, fill: theme.tooltipText }}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: theme.tooltipBg,
                    border: `1px solid ${theme.tooltipBorder}`,
                    borderRadius: 8,
                  }}
                  labelStyle={{ color: theme.tooltipText, fontWeight: 600 }}
                  itemStyle={{ color: theme.tooltipText }}
                  formatter={(v: number) => yen(v)}
                />
                <Line
                  type="monotone"
                  dataKey="total"
                  name="総資産"
                  stroke={theme.net}
                  strokeWidth={2.5}
                  dot={false}
                  isAnimationActive={false}
                />
                {tickers
                  .filter((t) => visibleTickers.has(t.ticker))
                  .map((t) => {
                    const i = tickers.findIndex((x) => x.ticker === t.ticker);
                    return (
                      <Line
                        key={t.ticker}
                        type="monotone"
                        dataKey={t.ticker}
                        name={t.name}
                        stroke={ASSET_COLORS[i % ASSET_COLORS.length]}
                        strokeWidth={1.5}
                        dot={false}
                        strokeDasharray="3 3"
                        isAnimationActive={false}
                      />
                    );
                  })}
              </LineChart>
            )}
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="text-sm text-muted-foreground text-center py-8">
          {loading ? "株価履歴を取得中..." : "履歴データがありません。売買記録を追加すると表示されます。"}
        </div>
      )}
    </section>
  );
}
