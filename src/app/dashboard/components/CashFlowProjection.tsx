"use client";

import { useMemo } from "react";
import Link from "next/link";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  CashBalanceSnapshotRow,
  FixedCostMasterRow,
  PaymentMethodRow,
  TransactionRow,
} from "@/lib/types";
import { yen, todayIso, makeTickFormatter, yAxisUnit } from "@/lib/format";
import { buildCashFlowProjection } from "@/lib/cashFlow";
import { useChartTheme } from "@/lib/chartTheme";

/** Add `delta` days to YYYY-MM-DD (local). */
function addDays(iso: string, delta: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d + delta);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

const HORIZON_DAYS = 60;

export default function CashFlowProjection({
  snapshots,
  transactions,
  paymentMethods,
  fixedCostMasters,
}: {
  snapshots: CashBalanceSnapshotRow[];
  transactions: TransactionRow[];
  paymentMethods: PaymentMethodRow[];
  fixedCostMasters: FixedCostMasterRow[];
}) {
  const theme = useChartTheme();

  const result = useMemo(() => {
    const today = todayIso();
    const endDate = addDays(today, HORIZON_DAYS);
    const fromDate = addDays(today, -3); // small lead-in so today doesn't sit on the y-axis
    return buildCashFlowProjection({
      snapshots,
      transactions,
      paymentMethods,
      fixedCostMasters,
      fromDate,
      endDate,
    });
  }, [snapshots, transactions, paymentMethods, fixedCostMasters]);

  if (snapshots.length === 0) {
    return (
      <section className="card">
        <h2 className="font-semibold mb-1">キャッシュフロー予測（60日）</h2>
        <p className="text-sm text-muted-foreground mb-3">
          現在の現金残高を登録すると、今後60日分の推移と引き落としタイミング毎の残高変化が表示されます。
        </p>
        <Link href="/settings?tab=cash" className="btn-primary text-sm inline-block">
          現金残高を登録する
        </Link>
      </section>
    );
  }

  const { days, anchor, upcomingOutflow, upcomingInflow, firstShortfallDate } = result;
  const today = todayIso();
  const todayBalance = days.find((d) => d.date === today)?.balance ?? anchor?.balance ?? 0;
  const endBalance = days.length > 0 ? days[days.length - 1].balance : todayBalance;
  const minBalance = days.reduce((m, d) => Math.min(m, d.balance), todayBalance);
  const upcomingNet = upcomingInflow - upcomingOutflow;
  const insufficient = firstShortfallDate !== null;
  const willCover = todayBalance >= upcomingOutflow;

  const yMaxAbs = Math.max(Math.abs(minBalance), Math.abs(endBalance), Math.abs(todayBalance));
  const unit = yAxisUnit(yMaxAbs || 1);

  const chartData = days.map((d) => ({
    date: d.date,
    balance: d.balance,
    net: d.netChange,
    events: d.events,
  }));

  const xTickInterval = chartData.length > 8 ? Math.floor(chartData.length / 8) : 0;

  return (
    <section className="card">
      <h2 className="font-semibold mb-1">キャッシュフロー予測（60日）</h2>
      <p className="text-xs text-muted-foreground mb-3">
        最終スナップショット {anchor?.date} の残高 {yen(anchor?.balance ?? 0)} を起点に、今後の現金支出・カード引落・収入を反映した日次残高。
      </p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
        <Stat label="本日の予測残高" value={yen(todayBalance)} tone={todayBalance < 0 ? "bad" : "neutral"} />
        <Stat
          label="60日後の残高"
          value={yen(endBalance)}
          tone={endBalance < 0 ? "bad" : endBalance < todayBalance ? "warn" : "good"}
        />
        <Stat
          label="今後の引落・支出計"
          value={yen(upcomingOutflow)}
          tone={willCover ? "neutral" : "bad"}
          sub={willCover ? "現金で賄える見込み" : "残高不足の恐れ"}
        />
        <Stat
          label="今後の収入計（既登録分）"
          value={yen(upcomingInflow)}
          tone="good"
          sub={`差引 ${yen(upcomingNet)}`}
        />
      </div>

      {insufficient && (
        <div className="rounded-xl bg-destructive/10 border border-destructive/30 text-destructive p-3 text-sm mb-3">
          ⚠️ {firstShortfallDate} に残高がマイナスになる予測です。引落口座への入金を検討してください。
        </div>
      )}

      <div style={{ height: 260 }}>
        <ResponsiveContainer>
          <AreaChart data={chartData} margin={{ top: 36, right: 4, bottom: 5, left: 0 }}>
            <defs>
              <linearGradient id="cfGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={theme.income} stopOpacity={0.5} />
                <stop offset="100%" stopColor={theme.income} stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={theme.grid} />
            <XAxis
              dataKey="date"
              fontSize={11}
              interval={xTickInterval}
              tickFormatter={(v: string) => v.slice(5)}
            />
            <YAxis
              fontSize={11}
              width={40}
              tickFormatter={makeTickFormatter(unit.divisor)}
              label={{
                value: unit.label,
                position: "top",
                offset: 14,
                fontSize: 11,
                fill: theme.tooltipText,
              }}
            />
            <Tooltip
              contentStyle={{ backgroundColor: theme.tooltipBg, border: `1px solid ${theme.tooltipBorder}`, borderRadius: 8 }}
              labelStyle={{ color: theme.tooltipText, fontWeight: 600 }}
              itemStyle={{ color: theme.tooltipText }}
              content={({ active, payload, label }) => {
                if (!active || !payload || payload.length === 0) return null;
                const row = payload[0].payload as { date: string; balance: number; net: number; events: { label: string; amount: number; count: number }[] };
                return (
                  <div style={{ background: theme.tooltipBg, border: `1px solid ${theme.tooltipBorder}`, borderRadius: 8, padding: 8, color: theme.tooltipText, fontSize: 12, maxWidth: 280 }}>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>{label}</div>
                    <div>残高: <span className="tabular-nums">{yen(row.balance)}</span></div>
                    {row.net !== 0 && (
                      <div>当日変動: <span className="tabular-nums">{row.net > 0 ? "+" : ""}{yen(row.net)}</span></div>
                    )}
                    {row.events.length > 0 && row.events.some((e) => e.amount !== 0) && (
                      <div style={{ marginTop: 4, paddingTop: 4, borderTop: `1px solid ${theme.tooltipBorder}` }}>
                        {row.events.filter((e) => e.amount !== 0).map((e, i) => (
                          <div key={i} style={{ display: "flex", gap: 6, justifyContent: "space-between" }}>
                            <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>
                              {e.label}{e.count > 1 ? ` ×${e.count}` : ""}
                            </span>
                            <span className="tabular-nums">{e.amount > 0 ? "+" : ""}{yen(e.amount)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              }}
            />
            <ReferenceLine y={0} stroke="hsl(var(--destructive))" strokeDasharray="3 3" />
            <ReferenceLine
              x={today}
              stroke={theme.tooltipText}
              strokeDasharray="2 2"
              label={{
                value: "今日",
                position: "top",
                offset: 4,
                fontSize: 11,
                fill: theme.tooltipText,
              }}
            />
            <Area
              type="stepAfter"
              dataKey="balance"
              stroke={theme.income}
              fill="url(#cfGrad)"
              strokeWidth={2}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Upcoming events table */}
      <UpcomingEvents days={days} />
    </section>
  );
}

function Stat({
  label,
  value,
  tone = "neutral",
  sub,
}: {
  label: string;
  value: string;
  tone?: "good" | "warn" | "bad" | "neutral";
  sub?: string;
}) {
  const toneClass =
    tone === "bad" ? "text-destructive" : tone === "warn" ? "text-warning" : tone === "good" ? "text-success" : "";
  return (
    <div className="rounded-xl border border-border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-lg font-bold tabular-nums ${toneClass}`}>{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

function UpcomingEvents({
  days,
}: {
  days: { date: string; balance: number; netChange: number; events: { label: string; amount: number; count: number }[] }[];
}) {
  const today = todayIso();
  // Show ≤30 upcoming days with a non-snapshot event. Each row = one
  // (date × source) bucket — i.e. one row per card, not per transaction.
  const upcoming = days
    .filter((d) => d.date >= today && d.events.some((e) => e.amount !== 0))
    .slice(0, 30);
  if (upcoming.length === 0) {
    return (
      <p className="mt-3 text-xs text-muted-foreground">直近の引落・支出予定はありません。</p>
    );
  }
  return (
    <div className="mt-3 max-h-64 overflow-y-auto rounded-lg border border-border">
      <table className="w-full text-xs">
        <thead className="bg-muted text-muted-foreground sticky top-0">
          <tr>
            <th className="text-left p-2 font-medium">日付</th>
            <th className="text-left p-2 font-medium">内容</th>
            <th className="text-right p-2 font-medium">金額</th>
            <th className="text-right p-2 font-medium">引落後残高</th>
          </tr>
        </thead>
        <tbody>
          {upcoming.flatMap((d) => {
            const evs = d.events.filter((e) => e.amount !== 0);
            return evs.map((e, i) => (
              <tr key={`${d.date}-${i}`} className="border-t border-border">
                <td className="p-2 tabular-nums whitespace-nowrap">{i === 0 ? d.date.slice(5) : ""}</td>
                <td className="p-2 truncate">
                  {e.label}
                  {e.count > 1 && <span className="ml-1 text-muted-foreground">({e.count}件)</span>}
                </td>
                <td className={`p-2 text-right tabular-nums whitespace-nowrap ${e.amount < 0 ? "text-destructive" : "text-success"}`}>
                  {e.amount > 0 ? "+" : ""}{yen(e.amount)}
                </td>
                <td className={`p-2 text-right tabular-nums whitespace-nowrap ${d.balance < 0 ? "text-destructive font-semibold" : ""}`}>
                  {i === evs.length - 1 ? yen(d.balance) : ""}
                </td>
              </tr>
            ));
          })}
        </tbody>
      </table>
    </div>
  );
}
