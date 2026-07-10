"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import clsx from "clsx";
import type {
  InvestmentAccountRow,
  InvestmentHoldingRow,
  InvestmentTransactionRow,
  UserRow,
} from "@/lib/types";
import { yen, todayIso, formatJaDate } from "@/lib/format";
import {
  searchStocks,
  getPriceUnit,
  getTickerCurrency,
  getTickerType,
  getTickerLabels,
  type StockItem,
} from "@/lib/stockList";
import { recordTrade, bulkRecordTrades, deleteInvestmentTransactions, updateTrade } from "../actions/investment";
import { holdingValueJpy } from "@/lib/stockMath";

type Props = {
  users: UserRow[];
  accounts: InvestmentAccountRow[];
  holdings: InvestmentHoldingRow[];
  trades: InvestmentTransactionRow[];
  initialPrices?: Record<string, LivePrice>;
};

type LivePrice = { price: number; currency: string; priceUnit: number };

/* ------------- Helpers ------------- */
async function fetchPrice(ticker: string): Promise<LivePrice | null> {
  try {
    const res = await fetch(`/api/stock-price?ticker=${encodeURIComponent(ticker)}`);
    const json = await res.json();
    if (json.error) return null;
    return { price: json.price, currency: json.currency ?? "USD", priceUnit: json.priceUnit ?? 1 };
  } catch {
    return null;
  }
}

function holdingCostJpy(h: InvestmentHoldingRow): number {
  const priceUnit = getPriceUnit(h.ticker);
  return Math.round((h.quantity * h.avg_cost_usd) / priceUnit * h.exchange_rate);
}

/** Human-readable elapsed time since `ts` in Japanese. */
function formatRelativeTime(ts: number | null): string {
  if (!ts) return "未取得";
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 60) return `${diffSec}秒前`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}分前`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}時間前`;
  return `${Math.floor(diffH / 24)}日前`;
}

/** Format price with correct currency label. */
function formatPrice(price: number, ticker: string, showPerUnit = false): string {
  const currency = getTickerCurrency(ticker);
  const priceUnit = getPriceUnit(ticker);
  if (currency === "JPY") {
    if (priceUnit > 1 && showPerUnit) {
      return `¥${Math.round(price).toLocaleString("ja-JP")}/万口`;
    }
    return `¥${Math.round(price).toLocaleString("ja-JP")}`;
  }
  return `$${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/* ================================================================ */
export default function InvestmentClient({ users, accounts, holdings, trades, initialPrices }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [bulkUpdating, setBulkUpdating] = useState(false);
  const [priceMap, setPriceMap] = useState<Map<string, LivePrice>>(() => {
    const m = new Map<string, LivePrice>();
    if (initialPrices) {
      for (const [k, v] of Object.entries(initialPrices)) m.set(k, v);
    }
    return m;
  });
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Wall-clock timestamp of the last successful (full or partial) price refresh.
  // Initialized to "now" when SSR supplied prices since those were just fetched
  // server-side; falsy otherwise so the indicator shows "未取得" until the first
  // client fetch completes.
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(() =>
    initialPrices && Object.keys(initialPrices).length > 0 ? Date.now() : null,
  );
  const [, forceTick] = useState(0);

  /* Selection mode state for trade history */
  const [selectMode, setSelectMode] = useState(false);
  const [selectedTradeIds, setSelectedTradeIds] = useState<Set<string>>(new Set());
  const [editingTrade, setEditingTrade] = useState<InvestmentTransactionRow | null>(null);

  /* Trade history filter/sort state */
  const [tradeFilter, setTradeFilter] = useState({
    from: "",
    to: "",
    accountId: "" as string,
    action: "" as "" | "buy" | "sell",
    query: "",
  });
  const [tradeSort, setTradeSort] = useState<{
    key: "date" | "amount" | "ticker";
    dir: "asc" | "desc";
  }>({ key: "date", dir: "desc" });

  /* Holdings sort state — default: largest value first */
  type HoldingSortKey = "ticker" | "quantity" | "avgCost" | "price" | "value" | "gain";
  const [holdingSort, setHoldingSort] = useState<{ key: HoldingSortKey; dir: "asc" | "desc" }>({
    key: "value",
    dir: "desc",
  });
  const toggleHoldingSort = useCallback((key: HoldingSortKey) => {
    setHoldingSort((prev) => {
      if (prev.key === key) return { key, dir: prev.dir === "asc" ? "desc" : "asc" };
      // Sensible defaults: numeric columns desc (largest first), ticker asc (A→Z)
      return { key, dir: key === "ticker" ? "asc" : "desc" };
    });
  }, []);

  // Always-fresh ref: avoids stale closure when interval fires after props update
  const holdingsRef = useRef(holdings);
  holdingsRef.current = holdings;

  /* Deduplicate holdings: latest per (account, ticker) */
  const deduped = useMemo(() => {
    const seen = new Set<string>();
    return holdings.filter((h) => {
      const key = `${h.account_id}::${h.ticker}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [holdings]);

  /* Sorted holdings — default value-desc; numeric cols depend on live price */
  const sortedHoldings = useMemo(() => {
    const arr = [...deduped];
    const sign = holdingSort.dir === "asc" ? 1 : -1;
    arr.sort((a, b) => {
      const liveA = priceMap.get(a.ticker);
      const liveB = priceMap.get(b.ticker);
      let cmp = 0;
      switch (holdingSort.key) {
        case "ticker":
          cmp = a.ticker.localeCompare(b.ticker);
          break;
        case "quantity":
          cmp = a.quantity - b.quantity;
          break;
        case "avgCost":
          cmp = a.avg_cost_usd - b.avg_cost_usd;
          break;
        case "price": {
          const pa = liveA?.price ?? a.current_price_usd;
          const pb = liveB?.price ?? b.current_price_usd;
          cmp = pa - pb;
          break;
        }
        case "value":
          cmp = holdingValueJpy(a, liveA) - holdingValueJpy(b, liveB);
          break;
        case "gain": {
          const ga = holdingValueJpy(a, liveA) - holdingCostJpy(a);
          const gb = holdingValueJpy(b, liveB) - holdingCostJpy(b);
          cmp = ga - gb;
          break;
        }
      }
      return cmp * sign;
    });
    return arr;
  }, [deduped, priceMap, holdingSort]);

  /* Live totals computed from priceMap */
  const { totalJpy, totalGainJpy } = useMemo(() => {
    let totalJpy = 0;
    let totalGainJpy = 0;
    for (const h of deduped) {
      const live = priceMap.get(h.ticker);
      const val = holdingValueJpy(h, live);
      const cost = holdingCostJpy(h);
      totalJpy += val;
      totalGainJpy += val - cost;
    }
    return { totalJpy, totalGainJpy };
  }, [deduped, priceMap]);

  /**
   * Realized gain/loss: walk trades in chronological order per ticker.
   * On every sell: realized += (sell_price - running_avg_cost) * qty / priceUnit * exchange_rate
   */
  const realizedGainJpy = useMemo(() => {
    const positions = new Map<string, { qty: number; totalCost: number }>();
    const sorted = [...trades].sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 : 0
    );
    let realized = 0;
    for (const t of sorted) {
      const priceUnit = getPriceUnit(t.ticker);
      const pos = positions.get(t.ticker) ?? { qty: 0, totalCost: 0 };
      if (t.action === "buy") {
        pos.qty += t.quantity;
        pos.totalCost += t.quantity * t.price_usd;
      } else {
        const avgCost = pos.qty > 0 ? pos.totalCost / pos.qty : t.price_usd;
        const gainNative = (t.price_usd - avgCost) * t.quantity;
        realized += Math.round((gainNative / priceUnit) * t.exchange_rate);
        const sellQty = Math.min(t.quantity, pos.qty);
        const newQty = Math.max(0, pos.qty - sellQty);
        pos.totalCost = pos.qty > 0 ? pos.totalCost * (newQty / pos.qty) : 0;
        pos.qty = newQty;
      }
      positions.set(t.ticker, pos);
    }
    return realized;
  }, [trades]);

  /* Account-level summary */
  const accountSummary = useMemo(() => {
    const map = new Map<string, { value: number; gain: number }>();
    for (const a of accounts) map.set(a.id, { value: 0, gain: 0 });
    for (const h of deduped) {
      const live = priceMap.get(h.ticker);
      const val = holdingValueJpy(h, live);
      const cost = holdingCostJpy(h);
      const s = map.get(h.account_id);
      if (s) { s.value += val; s.gain += val - cost; }
    }
    return map;
  }, [accounts, deduped, priceMap]);

  /* Per-user summary (aggregates accounts owned by each user) */
  const userSummary = useMemo(() => {
    const map = new Map<string, { value: number; gain: number }>();
    for (const u of users) map.set(u.id, { value: 0, gain: 0 });
    for (const a of accounts) {
      const s = accountSummary.get(a.id);
      const u = map.get(a.user_id);
      if (s && u) { u.value += s.value; u.gain += s.gain; }
    }
    return map;
  }, [users, accounts, accountSummary]);

  /* Trade history: filter + sort */
  const filteredSortedTrades = useMemo(() => {
    const f = tradeFilter;
    const q = f.query.trim().toLowerCase();
    const filtered = trades.filter((t) => {
      if (f.from && t.date < f.from) return false;
      if (f.to && t.date > f.to) return false;
      if (f.accountId && t.account_id !== f.accountId) return false;
      if (f.action && t.action !== f.action) return false;
      if (q) {
        const labels = getTickerLabels(t.ticker, t.name);
        const hay =
          `${t.ticker} ${labels.primary} ${labels.secondary} ${t.name ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    const sign = tradeSort.dir === "asc" ? 1 : -1;
    filtered.sort((a, b) => {
      let cmp = 0;
      if (tradeSort.key === "date") {
        cmp = a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
      } else if (tradeSort.key === "amount") {
        cmp = a.amount_jpy - b.amount_jpy;
      } else {
        cmp = a.ticker.localeCompare(b.ticker);
      }
      return cmp * sign;
    });
    return filtered;
  }, [trades, tradeFilter, tradeSort]);

  const toggleSort = useCallback((key: "date" | "amount" | "ticker") => {
    setTradeSort((prev) => {
      if (prev.key === key) return { key, dir: prev.dir === "asc" ? "desc" : "asc" };
      // Sensible defaults: date=desc (newest first), amount=desc (largest first), ticker=asc
      return { key, dir: key === "ticker" ? "asc" : "desc" };
    });
  }, []);

  /**
   * Fetch live prices for all holdings and update client-side priceMap only.
   * Does NOT write to DB — correct quantities come from recalculateHoldingsFromTrades.
   */
  const bulkUpdatePrices = useCallback(async () => {
    const current = holdingsRef.current;
    if (current.length === 0) return;
    setBulkUpdating(true);
    setErr(null);
    const uniqueTickers = Array.from(new Set(current.map((h) => h.ticker)));
    const results = await Promise.all(
      uniqueTickers.map(async (t) => ({ ticker: t, price: await fetchPrice(t) }))
    );
    const newMap = new Map<string, LivePrice>();
    let ok = 0;
    let fail = 0;
    for (const { ticker, price } of results) {
      if (price) {
        newMap.set(ticker, price);
        ok++;
      } else {
        fail++;
      }
    }
    setPriceMap(newMap);
    if (ok > 0) setLastUpdatedAt(Date.now());
    setBulkUpdating(false);
    if (fail > 0) setErr(`${ok} 銘柄更新 / ${fail} 失敗`);
  }, []); // stable — reads fresh data via holdingsRef

  /* Refresh on a 5-minute interval. Skip initial fetch if SSR already
   * supplied prices — they're at most a few seconds old. */
  useEffect(() => {
    if (!initialPrices || Object.keys(initialPrices).length === 0) {
      bulkUpdatePrices();
    }
    intervalRef.current = setInterval(() => {
      if (document.visibilityState !== "hidden") bulkUpdatePrices();
    }, 5 * 60 * 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [bulkUpdatePrices, initialPrices]);

  /* Pull-to-refresh wiring: when the user pulls down on this tab we want the
   * live prices to update immediately, not just the server-rendered data. */
  useEffect(() => {
    const onRefresh = () => bulkUpdatePrices();
    window.addEventListener("app:refresh", onRefresh);
    return () => window.removeEventListener("app:refresh", onRefresh);
  }, [bulkUpdatePrices]);

  /* Re-render every 5s so the "last updated N seconds ago" label stays
   * accurate without forcing every other piece of UI to re-render. */
  useEffect(() => {
    const id = setInterval(() => forceTick((n) => (n + 1) % 1_000_000), 5000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-bold">投資管理</h1>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span aria-live="polite">
            {bulkUpdating
              ? "株価取得中..."
              : `最終更新: ${formatRelativeTime(lastUpdatedAt)}`}
          </span>
          <button
            type="button"
            className="btn-ghost text-xs px-2 py-1"
            disabled={bulkUpdating}
            onClick={bulkUpdatePrices}
            aria-label="株価を更新"
          >
            ↻
          </button>
        </div>
      </div>

      {/* Summary */}
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="card">
          <div className="text-xs text-muted-foreground">実現損益（円）</div>
          <div className={clsx("text-xl font-bold", realizedGainJpy >= 0 ? "text-success" : "text-destructive")}>
            {yen(realizedGainJpy)}
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5">売却により確定した累計損益</div>
        </div>
        <div className="card">
          <div className="text-xs text-muted-foreground">総評価額（円）</div>
          <div className="text-xl font-bold">{yen(totalJpy)}</div>
        </div>
        <div className="card">
          <div className="text-xs text-muted-foreground">含み損益（円）</div>
          <div className={clsx("text-xl font-bold", totalGainJpy >= 0 ? "text-success" : "text-destructive")}>
            {yen(totalGainJpy)}
          </div>
        </div>
      </section>

      {/* Accounts (grouped by user) */}
      <section className="card">
        <h2 className="font-semibold mb-3">証券口座</h2>
        {users.map((u) => {
          const ownerAccounts = accounts.filter((a) => a.user_id === u.id);
          if (ownerAccounts.length === 0) return null;
          const us = userSummary.get(u.id);
          return (
            <div key={u.id} className="mb-4 last:mb-0">
              <div className="bg-muted/50 rounded-md px-3 py-2 mb-2">
                <div className="text-sm font-semibold">{u.name}</div>
              </div>
              <ul className="divide-y divide-border text-sm">
                {ownerAccounts.map((a) => {
                  const s = accountSummary.get(a.id);
                  const isSbi = (a.provider ?? "").toLowerCase().includes("sbi") ||
                    (a.account_name ?? "").toLowerCase().includes("sbi");
                  return (
                    <li key={a.id} className="py-2 flex items-center justify-between gap-3">
                      <div>
                        <div className="font-medium">{a.account_name}</div>
                        <div className="text-xs text-muted-foreground">{a.provider}</div>
                      </div>
                      <div className="flex items-center gap-4">
                        {isSbi && s && (
                          <div className="text-right">
                            <div className="text-sm font-semibold">{yen(s.value)}</div>
                            <div className={clsx("text-xs", s.gain >= 0 ? "text-success" : "text-destructive")}>
                              {s.gain >= 0 ? "+" : ""}{yen(s.gain)}
                            </div>
                          </div>
                        )}
                        <span className={clsx("chip text-xs shrink-0", a.is_active ? "bg-success/15 text-success" : "bg-muted")}>
                          {a.is_active ? "有効" : "無効"}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
        {accounts.length === 0 && (
          <div className="py-2 space-y-2">
            <p className="text-muted-foreground text-sm">証券口座が未登録です。追加すると保有銘柄や売買履歴を記録できます。</p>
            <Link href="/settings?tab=accounts" className="btn-primary text-sm inline-block">
              証券口座を追加する
            </Link>
          </div>
        )}
      </section>

      {/* Holdings */}
      <section className="card">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h2 className="font-semibold">保有銘柄</h2>
          <div className="flex items-center gap-2">
            {bulkUpdating && (
              <span className="text-xs text-muted-foreground animate-pulse">株価取得中...</span>
            )}
            {deduped.length > 0 && (
              <button
                className="btn-ghost text-xs"
                disabled={bulkUpdating}
                onClick={bulkUpdatePrices}
              >
                {bulkUpdating ? "更新中..." : "↻ 株価を手動更新"}
              </button>
            )}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px] border-separate border-spacing-0">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <SortableTh
                  className="sticky left-0 z-20 bg-card text-left whitespace-nowrap px-2 py-1.5 border-b border-r border-border"
                  active={holdingSort.key === "ticker"}
                  dir={holdingSort.dir}
                  onClick={() => toggleHoldingSort("ticker")}
                >
                  銘柄
                </SortableTh>
                <SortableTh
                  className="text-right whitespace-nowrap px-2 py-1.5 border-b border-border"
                  active={holdingSort.key === "quantity"}
                  dir={holdingSort.dir}
                  onClick={() => toggleHoldingSort("quantity")}
                >
                  株数/口数
                </SortableTh>
                <SortableTh
                  className="text-right whitespace-nowrap px-2 py-1.5 border-b border-border"
                  active={holdingSort.key === "avgCost"}
                  dir={holdingSort.dir}
                  onClick={() => toggleHoldingSort("avgCost")}
                >
                  平均取得単価
                </SortableTh>
                <SortableTh
                  className="text-right whitespace-nowrap px-2 py-1.5 border-b border-border"
                  active={holdingSort.key === "price"}
                  dir={holdingSort.dir}
                  onClick={() => toggleHoldingSort("price")}
                >
                  現在価格
                </SortableTh>
                <SortableTh
                  className="text-right whitespace-nowrap px-2 py-1.5 border-b border-border"
                  active={holdingSort.key === "value"}
                  dir={holdingSort.dir}
                  onClick={() => toggleHoldingSort("value")}
                >
                  評価額(円)
                </SortableTh>
                <SortableTh
                  className="text-right whitespace-nowrap px-2 py-1.5 border-b border-border"
                  active={holdingSort.key === "gain"}
                  dir={holdingSort.dir}
                  onClick={() => toggleHoldingSort("gain")}
                >
                  損益(円)
                </SortableTh>
              </tr>
            </thead>
            <tbody>
              {sortedHoldings.map((h) => {
                const live = priceMap.get(h.ticker);
                const val = holdingValueJpy(h, live);
                const cost = holdingCostJpy(h);
                const gain = val - cost;
                const isFund = getPriceUnit(h.ticker) > 1;
                const livePrice = live?.price ?? h.current_price_usd;
                const labels = getTickerLabels(h.ticker, h.name);
                return (
                  <tr key={h.id}>
                    <td className="sticky left-0 z-10 bg-card px-2 py-1.5 text-xs whitespace-nowrap border-b border-r border-border">
                      <div
                        className="font-medium truncate max-w-[200px] leading-tight"
                        title={labels.primary}
                      >
                        {labels.primary}
                      </div>
                      {labels.secondary && (
                        <div
                          className={clsx(
                            "truncate max-w-[200px] leading-tight text-muted-foreground",
                            isFund ? "text-[10px]" : "font-mono text-[10px]"
                          )}
                          title={labels.secondary}
                        >
                          {labels.secondary}
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right text-xs whitespace-nowrap tabular-nums border-b border-border">
                      {h.quantity.toLocaleString("ja-JP")}
                      {isFund ? "口" : "株"}
                    </td>
                    <td className="px-2 py-1.5 text-right text-xs whitespace-nowrap tabular-nums border-b border-border">{formatPrice(h.avg_cost_usd, h.ticker, true)}</td>
                    <td className="px-2 py-1.5 text-right text-xs whitespace-nowrap tabular-nums border-b border-border">
                      {formatPrice(livePrice, h.ticker, true)}
                      {live && <span className="ml-1 text-success">●</span>}
                    </td>
                    <td className="px-2 py-1.5 text-right text-xs whitespace-nowrap tabular-nums border-b border-border">{yen(val)}</td>
                    <td className={clsx("px-2 py-1.5 text-right text-xs whitespace-nowrap tabular-nums font-medium border-b border-border", gain >= 0 ? "text-success" : "text-destructive")}>
                      {gain >= 0 ? "+" : ""}{yen(gain)}
                    </td>
                  </tr>
                );
              })}
              {deduped.length === 0 && (
                <tr><td colSpan={6} className="text-center text-muted-foreground py-4">保有銘柄の記録がありません。</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Trade recorder */}
      <section className="card">
        <h2 className="font-semibold mb-3">売買を記録（家計に連動）</h2>
        <TradeForm users={users} accounts={accounts} holdings={deduped} onError={setErr} pending={pending} start={start} />
        <CsvImport
          users={users}
          accounts={accounts}
          onError={setErr}
          onImported={() => { router.refresh(); }}
        />
      </section>

      {/* Trade history */}
      <section className="card">
        <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
          <h2 className="font-semibold">
            売買履歴
            {(() => {
              const total = trades.length;
              const shown = filteredSortedTrades.length;
              if (shown === total) return null;
              return (
                <span className="ml-2 text-xs text-muted-foreground font-normal">
                  {shown} / {total}件
                </span>
              );
            })()}
          </h2>
          {trades.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap justify-end">
              {!selectMode ? (
                <button
                  className="btn-ghost text-xs"
                  onClick={() => { setSelectMode(true); setSelectedTradeIds(new Set()); }}
                >
                  選択
                </button>
              ) : (
                <>
                  <span className="text-xs text-muted-foreground">{selectedTradeIds.size}件選択中</span>
                  <button
                    className="btn-ghost text-xs"
                    onClick={() => {
                      setSelectedTradeIds((prev) =>
                        prev.size === trades.length
                          ? new Set()
                          : new Set(trades.map((t) => t.id))
                      );
                    }}
                  >
                    {selectedTradeIds.size === trades.length ? "全解除" : "全選択"}
                  </button>
                  <button
                    className="btn-secondary text-xs"
                    disabled={pending || selectedTradeIds.size !== 1}
                    title={selectedTradeIds.size === 1 ? "選択した取引を編集" : "編集は1件選択時のみ"}
                    onClick={() => {
                      if (selectedTradeIds.size !== 1) return;
                      const id = Array.from(selectedTradeIds)[0];
                      const tr = trades.find((t) => t.id === id);
                      if (tr) setEditingTrade(tr);
                    }}
                  >
                    編集
                  </button>
                  <button
                    className="btn-danger text-xs"
                    disabled={pending || selectedTradeIds.size === 0}
                    onClick={() => {
                      if (selectedTradeIds.size === 0) return;
                      if (!confirm(`${selectedTradeIds.size}件の取引と連動する現金取引を削除しますか？`)) return;
                      start(async () => {
                        try {
                          await deleteInvestmentTransactions(Array.from(selectedTradeIds));
                          setErr(null);
                          setSelectedTradeIds(new Set());
                          setSelectMode(false);
                        } catch (err: unknown) {
                          setErr(err instanceof Error ? err.message : String(err));
                        }
                      });
                    }}
                  >
                    削除
                  </button>
                  <button
                    className="btn-ghost text-xs"
                    onClick={() => { setSelectMode(false); setSelectedTradeIds(new Set()); }}
                  >
                    キャンセル
                  </button>
                </>
              )}
            </div>
          )}
        </div>
        {trades.length > 0 && (
          <TradeFilterBar
            filter={tradeFilter}
            setFilter={setTradeFilter}
            accounts={accounts}
            users={users}
          />
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px] border-separate border-spacing-0">
            <thead className="text-xs text-muted-foreground">
              <tr>
                {selectMode && <th className="bg-card w-10 px-2 py-1.5 border-b border-border"></th>}
                <SortableTh
                  className="sticky left-0 z-20 bg-card text-left whitespace-nowrap px-2 py-1.5 border-b border-r border-border"
                  active={tradeSort.key === "ticker"}
                  dir={tradeSort.dir}
                  onClick={() => toggleSort("ticker")}
                >
                  銘柄
                </SortableTh>
                <SortableTh
                  className="text-left whitespace-nowrap px-2 py-1.5 border-b border-border"
                  active={tradeSort.key === "date"}
                  dir={tradeSort.dir}
                  onClick={() => toggleSort("date")}
                >
                  日付
                </SortableTh>
                <th className="text-left whitespace-nowrap px-2 py-1.5 border-b border-border">口座</th>
                <th className="text-left whitespace-nowrap px-2 py-1.5 border-b border-border">売買</th>
                <th className="text-right whitespace-nowrap px-2 py-1.5 border-b border-border">数量</th>
                <th className="text-right whitespace-nowrap px-2 py-1.5 border-b border-border">単価</th>
                <SortableTh
                  className="text-right whitespace-nowrap px-2 py-1.5 border-b border-border"
                  active={tradeSort.key === "amount"}
                  dir={tradeSort.dir}
                  onClick={() => toggleSort("amount")}
                >
                  金額(円)
                </SortableTh>
              </tr>
            </thead>
            <tbody>
              {filteredSortedTrades.map((t) => {
                const checked = selectedTradeIds.has(t.id);
                const toggle = () => {
                  setSelectedTradeIds((prev) => {
                    const next = new Set(prev);
                    if (next.has(t.id)) next.delete(t.id);
                    else next.add(t.id);
                    return next;
                  });
                };
                const stickyBg = selectMode && checked ? "bg-primary/10" : "bg-card";
                return (
                  <tr
                    key={t.id}
                    className={clsx(selectMode && checked && "bg-primary/10")}
                    onClick={selectMode ? toggle : undefined}
                    style={selectMode ? { cursor: "pointer" } : undefined}
                  >
                    {selectMode && (
                      <td className={clsx("px-2 py-1.5 border-b border-border", stickyBg)}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={toggle}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </td>
                    )}
                    <td className={clsx("sticky left-0 z-10 px-2 py-1.5 whitespace-nowrap border-b border-r border-border", stickyBg)}>
                      {(() => {
                        const labels = getTickerLabels(t.ticker, t.name);
                        const isFund = getPriceUnit(t.ticker) > 1;
                        return (
                          <>
                            <div
                              className="text-xs font-medium truncate max-w-[180px] leading-tight"
                              title={labels.primary}
                            >
                              {labels.primary}
                            </div>
                            {labels.secondary && (
                              <div
                                className={clsx(
                                  "truncate max-w-[180px] leading-tight text-muted-foreground",
                                  isFund ? "text-[10px]" : "font-mono text-[10px]"
                                )}
                                title={labels.secondary}
                              >
                                {labels.secondary}
                              </div>
                            )}
                          </>
                        );
                      })()}
                    </td>
                    <td className="px-2 py-1.5 text-xs whitespace-nowrap tabular-nums border-b border-border">{formatJaDate(t.date)}</td>
                    <td className="px-2 py-1.5 text-xs whitespace-nowrap max-w-[180px] truncate border-b border-border">
                      {(() => {
                        const a = accounts.find((x) => x.id === t.account_id);
                        if (a) {
                          const owner = users.find((u) => u.id === a.user_id)?.name;
                          return owner ? `${owner} / ${a.account_name}` : a.account_name;
                        }
                        return users.find((u) => u.id === t.user_id)?.name ?? "-";
                      })()}
                    </td>
                    <td className={clsx("px-2 py-1.5 text-xs whitespace-nowrap font-medium border-b border-border", t.action === "buy" ? "text-destructive" : "text-success")}>
                      {t.action === "buy" ? "買" : "売"}
                    </td>
                    <td className="px-2 py-1.5 text-right text-xs whitespace-nowrap tabular-nums border-b border-border">{t.quantity.toLocaleString("ja-JP")}</td>
                    <td className="px-2 py-1.5 text-right text-xs whitespace-nowrap tabular-nums border-b border-border">{formatPrice(t.price_usd, t.ticker, true)}</td>
                    <td className="px-2 py-1.5 text-right text-xs whitespace-nowrap tabular-nums font-medium border-b border-border">{yen(t.amount_jpy)}</td>
                  </tr>
                );
              })}
              {trades.length === 0 && (
                <tr><td colSpan={selectMode ? 8 : 7} className="text-center text-muted-foreground py-4">売買履歴がありません。</td></tr>
              )}
              {trades.length > 0 && filteredSortedTrades.length === 0 && (
                <tr><td colSpan={selectMode ? 8 : 7} className="text-center text-muted-foreground py-4">条件に合う取引がありません。</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {err && <p className="text-sm text-destructive">{err}</p>}

      {editingTrade && (
        <EditTradeDialog
          trade={editingTrade}
          accounts={accounts}
          users={users}
          pending={pending}
          onClose={() => setEditingTrade(null)}
          onSave={(patched) => {
            start(async () => {
              try {
                await updateTrade(patched);
                setErr(null);
                setEditingTrade(null);
                setSelectMode(false);
                setSelectedTradeIds(new Set());
                router.refresh();
              } catch (e) {
                setErr(e instanceof Error ? e.message : String(e));
              }
            });
          }}
        />
      )}
    </div>
  );
}

/* =================== Edit trade dialog =================== */
function EditTradeDialog({
  trade,
  accounts,
  users,
  pending,
  onClose,
  onSave,
}: {
  trade: InvestmentTransactionRow;
  accounts: InvestmentAccountRow[];
  users: UserRow[];
  pending: boolean;
  onClose: () => void;
  onSave: (input: {
    id: string;
    date: string;
    account_id: string | null;
    ticker: string;
    name: string | null;
    action: "buy" | "sell";
    quantity: number;
    price_usd: number;
    exchange_rate: number;
    note: string | null;
  }) => void;
}) {
  const [date, setDate] = useState(trade.date);
  const [accountId, setAccountId] = useState<string>(trade.account_id ?? "");
  const [action, setAction] = useState<"buy" | "sell">(trade.action);
  const [quantity, setQuantity] = useState<string>(String(trade.quantity));
  const [price, setPrice] = useState<string>(String(trade.price_usd));
  const [rate, setRate] = useState<string>(String(trade.exchange_rate));
  const [note, setNote] = useState<string>(trade.note ?? "");
  const [local, setLocal] = useState<string | null>(null);

  const currency = getTickerCurrency(trade.ticker);
  const isFund = getPriceUnit(trade.ticker) > 1;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setLocal(null);
    const q = Number(quantity);
    const p = Number(price);
    const r = Number(rate);
    if (!Number.isFinite(q) || q <= 0) return setLocal("数量は0より大きい値を入力してください。");
    if (!Number.isFinite(p) || p < 0) return setLocal("単価は0以上を入力してください。");
    if (!Number.isFinite(r) || r <= 0) return setLocal("為替レートは0より大きい値を入力してください。");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return setLocal("日付の形式が正しくありません。");
    onSave({
      id: trade.id,
      date,
      account_id: accountId || null,
      ticker: trade.ticker,
      name: trade.name ?? null,
      action,
      quantity: q,
      price_usd: p,
      exchange_rate: r,
      note: note.trim() || null,
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="w-full max-w-md bg-card border border-border rounded-xl p-5 shadow-xl space-y-3"
      >
        <h3 className="font-semibold text-base">取引を編集</h3>
        <p className="text-xs text-muted-foreground">
          銘柄: <span className="font-mono">{trade.ticker}</span>
          {trade.name ? ` / ${trade.name}` : ""}
        </p>

        <label className="block space-y-1">
          <span className="text-xs font-medium">日付</span>
          <input
            type="date"
            className="input"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
          />
        </label>

        <label className="block space-y-1">
          <span className="text-xs font-medium">証券口座</span>
          <select
            className="input"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
          >
            <option value="">— 未指定 —</option>
            {accounts.map((a) => {
              const owner = users.find((u) => u.id === a.user_id)?.name;
              return (
                <option key={a.id} value={a.id}>
                  {owner ? `${owner} / ${a.account_name}` : a.account_name}
                </option>
              );
            })}
          </select>
        </label>

        <div className="grid grid-cols-2 gap-2">
          <label className="block space-y-1">
            <span className="text-xs font-medium">売買</span>
            <select
              className="input"
              value={action}
              onChange={(e) => setAction(e.target.value as "buy" | "sell")}
            >
              <option value="buy">買付</option>
              <option value="sell">売却</option>
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium">為替レート</span>
            <input
              type="number"
              step="0.0001"
              className="input"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              required
            />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="block space-y-1">
            <span className="text-xs font-medium">数量{isFund ? "（口）" : "（株）"}</span>
            <input
              type="number"
              step="0.000001"
              className="input"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              required
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium">
              単価（{currency}{isFund ? " / 万口" : ""}）
            </span>
            <input
              type="number"
              step="0.0001"
              className="input"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              required
            />
          </label>
        </div>

        <label className="block space-y-1">
          <span className="text-xs font-medium">メモ</span>
          <input
            type="text"
            className="input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={400}
          />
        </label>

        <p className="text-[11px] text-muted-foreground">
          ティッカーや銘柄名は変更できません。新規に作り直してください。
        </p>

        {local && (
          <p role="alert" className="text-xs text-destructive">
            {local}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-secondary text-sm" onClick={onClose} disabled={pending}>
            キャンセル
          </button>
          <button type="submit" className="btn-primary text-sm" disabled={pending}>
            {pending ? "保存中..." : "保存"}
          </button>
        </div>
      </form>
    </div>
  );
}

/* =================== Trade history filter & sort UI =================== */
function SortableTh({
  active,
  dir,
  onClick,
  children,
  className,
}: {
  active: boolean;
  dir: "asc" | "desc";
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={clsx(className, "cursor-pointer select-none hover:text-foreground")}
      onClick={onClick}
      role="button"
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        <span className="text-[9px] opacity-70">
          {active ? (dir === "asc" ? "▲" : "▼") : "↕"}
        </span>
      </span>
    </th>
  );
}

function TradeFilterBar({
  filter,
  setFilter,
  accounts,
  users,
}: {
  filter: { from: string; to: string; accountId: string; action: "" | "buy" | "sell"; query: string };
  setFilter: React.Dispatch<
    React.SetStateAction<{
      from: string;
      to: string;
      accountId: string;
      action: "" | "buy" | "sell";
      query: string;
    }>
  >;
  accounts: InvestmentAccountRow[];
  users: UserRow[];
}) {
  const isFiltered =
    filter.from || filter.to || filter.accountId || filter.action || filter.query.trim();
  return (
    <div className="mb-3 grid grid-cols-2 sm:grid-cols-6 gap-2 text-xs">
      <input
        type="date"
        className="input text-xs"
        value={filter.from}
        onChange={(e) => setFilter((p) => ({ ...p, from: e.target.value }))}
        placeholder="開始"
        aria-label="開始日"
      />
      <input
        type="date"
        className="input text-xs"
        value={filter.to}
        onChange={(e) => setFilter((p) => ({ ...p, to: e.target.value }))}
        placeholder="終了"
        aria-label="終了日"
      />
      <select
        className="input text-xs"
        value={filter.accountId}
        onChange={(e) => setFilter((p) => ({ ...p, accountId: e.target.value }))}
        aria-label="口座"
      >
        <option value="">すべての口座</option>
        {accounts.map((a) => {
          const owner = users.find((u) => u.id === a.user_id)?.name;
          return (
            <option key={a.id} value={a.id}>
              {owner ? `${owner} / ${a.account_name}` : a.account_name}
            </option>
          );
        })}
      </select>
      <select
        className="input text-xs"
        value={filter.action}
        onChange={(e) =>
          setFilter((p) => ({ ...p, action: e.target.value as "" | "buy" | "sell" }))
        }
        aria-label="売買"
      >
        <option value="">買・売すべて</option>
        <option value="buy">買のみ</option>
        <option value="sell">売のみ</option>
      </select>
      <input
        className="input text-xs col-span-2 sm:col-span-1"
        placeholder="銘柄を検索"
        value={filter.query}
        onChange={(e) => setFilter((p) => ({ ...p, query: e.target.value }))}
        aria-label="銘柄検索"
      />
      <button
        className="btn-ghost text-xs disabled:opacity-50"
        disabled={!isFiltered}
        onClick={() =>
          setFilter({ from: "", to: "", accountId: "", action: "", query: "" })
        }
      >
        条件クリア
      </button>
    </div>
  );
}

/* =================== Ticker Autocomplete =================== */
function TickerInput({
  value,
  onChange,
  onSelect,
  placeholder,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  onSelect: (item: StockItem) => void;
  placeholder?: string;
  className?: string;
}) {
  const [suggestions, setSuggestions] = useState<StockItem[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  async function handleChange(v: string) {
    onChange(v);
    const local = searchStocks(v);
    setSuggestions(local);
    setOpen(local.length > 0 || v.length >= 2);

    if (local.length < 2 && v.length >= 2) {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setLoading(true);
      try {
        const res = await fetch(`/api/stock-search?q=${encodeURIComponent(v)}`, { signal: ctrl.signal });
        const remote: StockItem[] = await res.json();
        const localTickers = new Set(local.map((s) => s.ticker));
        const merged = [...local, ...remote.filter((r) => !localTickers.has(r.ticker))].slice(0, 8);
        setSuggestions(merged);
        setOpen(merged.length > 0);
      } catch {
        // keep local results
      } finally {
        setLoading(false);
      }
    }
  }

  return (
    <div className="relative">
      <input
        className={className ?? "input"}
        placeholder={placeholder ?? "ティッカー"}
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && (
        <ul className="absolute z-20 left-0 right-0 top-full mt-1 bg-card border border-border rounded-xl shadow-lg max-h-48 overflow-y-auto text-sm">
          {suggestions.map((s) => (
            <li
              key={s.ticker}
              className="px-3 py-2 hover:bg-muted/50 cursor-pointer flex justify-between"
              onMouseDown={() => { onSelect(s); setOpen(false); }}
            >
              <span className="font-mono">{s.ticker}</span>
              <span className="text-muted-foreground text-xs">{s.name}</span>
            </li>
          ))}
          {loading && <li className="px-3 py-2 text-muted-foreground text-xs text-center">検索中...</li>}
        </ul>
      )}
    </div>
  );
}

/* =================== TradeForm =================== */
function TradeForm({
  users, accounts, holdings, onError, pending, start,
}: {
  users: UserRow[];
  accounts: InvestmentAccountRow[];
  holdings: InvestmentHoldingRow[];
  onError: (e: string | null) => void;
  pending: boolean;
  start: (fn: () => void) => void;
}) {
  const [form, setForm] = useState({
    date: todayIso(),
    user_id: users[0]?.id ?? "",
    account_id: accounts[0]?.id ?? "",
    ticker: "",
    name: "",
    action: "buy" as "buy" | "sell",
    quantity: "",
    price_usd: "",
    exchange_rate: "150",
    note: "",
  });
  const [tickerType, setTickerType] = useState<"US" | "JP" | "fund">("US");

  // On a sell, snap the account to the one that actually holds the ticker (and
  // its owner). This is the fix for the phantom-holding bug at its source: the
  // old default kept accounts[0], so a sell could land in the wrong account.
  useEffect(() => {
    if (form.action !== "sell" || !form.ticker) return;
    const h = holdings.find((x) => x.ticker === form.ticker && x.quantity > 0);
    if (!h || h.account_id === form.account_id) return;
    const owner = accounts.find((a) => a.id === h.account_id)?.user_id;
    setForm((prev) => ({ ...prev, account_id: h.account_id, user_id: owner ?? prev.user_id }));
  }, [form.action, form.ticker, form.account_id, holdings, accounts]);

  const isJpy = tickerType !== "US";
  const isFund = tickerType === "fund";
  const priceLabel = isFund ? "基準価額(¥/万口)" : isJpy ? "株価(¥)" : "単価($)";
  const quantityLabel = isFund ? "約定数量(口)" : "株数";

  return (
    <form
      className="grid grid-cols-2 sm:grid-cols-4 gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        onError(null);
        if (!form.account_id) return onError("口座を選択してください。");
        start(async () => {
          try {
            const res = await recordTrade({
              date: form.date,
              user_id: form.user_id,
              account_id: form.account_id,
              ticker: form.ticker,
              name: form.name || undefined,
              action: form.action,
              quantity: Number(form.quantity),
              price_usd: Number(form.price_usd),
              exchange_rate: Number(form.exchange_rate),
              note: form.note || undefined,
            });
            setForm({ ...form, ticker: "", name: "", quantity: "", price_usd: "", note: "" });
            onError(res.warnings.length > 0 ? `記録しました（注意: ${res.warnings.join(" / ")}）` : null);
          } catch (err: unknown) { onError(err instanceof Error ? err.message : String(err)); }
        });
      }}
    >
      <input type="date" className="input" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
      <select
        className="input"
        value={form.user_id}
        onChange={(e) => {
          const newUserId = e.target.value;
          // Reset account to first one owned by the new user
          const firstForUser = accounts.find((a) => a.user_id === newUserId);
          setForm({ ...form, user_id: newUserId, account_id: firstForUser?.id ?? "" });
        }}
      >
        {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
      </select>
      <select className="input" value={form.account_id} onChange={(e) => setForm({ ...form, account_id: e.target.value })}>
        {(() => {
          const owned = accounts.filter((a) => a.user_id === form.user_id);
          if (owned.length === 0) return <option value="">口座なし</option>;
          return owned.map((a) => <option key={a.id} value={a.id}>{a.account_name}</option>);
        })()}
      </select>
      <select className="input" value={form.action} onChange={(e) => setForm({ ...form, action: e.target.value as "buy" | "sell" })}>
        <option value="buy">買い</option>
        <option value="sell">売り</option>
      </select>
      <TickerInput
        value={form.ticker}
        onChange={(v) => {
          // Auto-detect type when a known ticker is typed (not only selected from dropdown)
          const detected = getTickerType(v);
          if (detected) {
            setTickerType(detected);
            setForm({
              ...form,
              ticker: v,
              exchange_rate: detected === "US" ? (form.exchange_rate === "1" ? "150" : form.exchange_rate) : "1",
            });
          } else {
            setForm({ ...form, ticker: v });
          }
        }}
        onSelect={(s) => {
          const type = s.type ?? "US";
          setTickerType(type);
          setForm((prev) => ({ ...prev, ticker: s.ticker, name: s.name, exchange_rate: type === "US" ? "150" : "1" }));
        }}
      />
      <input
        className="input"
        placeholder={quantityLabel}
        type="number"
        step="0.0001"
        value={form.quantity}
        onChange={(e) => setForm({ ...form, quantity: e.target.value })}
      />
      <input
        className="input"
        placeholder={priceLabel}
        type="number"
        step={isJpy ? "1" : "0.01"}
        value={form.price_usd}
        onChange={(e) => setForm({ ...form, price_usd: e.target.value })}
      />
      {!isJpy && (
        <input
          className="input"
          placeholder="為替¥/$"
          type="number"
          step="0.01"
          value={form.exchange_rate}
          onChange={(e) => setForm({ ...form, exchange_rate: e.target.value })}
        />
      )}
      <input
        className="input col-span-2"
        placeholder="メモ（任意）"
        value={form.note}
        onChange={(e) => setForm({ ...form, note: e.target.value })}
      />
      <button className="btn-primary col-span-2" disabled={pending}>記録</button>
    </form>
  );
}

/* =================== CSV Import =================== */
type CsvRow = {
  date: string;
  ticker: string;
  name: string;
  action: "buy" | "sell";
  quantity: number;
  price_usd: number;
  exchange_rate: number;
  note: string;
};

type CsvFormat = "generic" | "sbi_foreign" | "sbi_fund";

function parseSbiDate(s: string): string {
  const matchJa = s.replace(/"/g, "").match(/(\d{4})年(\d{2})月(\d{2})日/);
  if (matchJa) return `${matchJa[1]}-${matchJa[2]}-${matchJa[3]}`;
  const matchSlash = s.replace(/"/g, "").match(/(\d{4})\/(\d{2})\/(\d{2})/);
  if (matchSlash) return `${matchSlash[1]}-${matchSlash[2]}-${matchSlash[3]}`;
  return s.replace(/"/g, "").trim();
}

function extractTickerFromSbi(bankName: string): string {
  const match = bankName.match(/([A-Z]{1,5})\s*\//);
  return match ? match[1] : bankName.slice(0, 8);
}

function mapFundTicker(name: string): string {
  const normalized = name
    .replace(/[\uff01-\uff5e]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, " ");
  if (/NASDAQ100|iFreeNEXT/i.test(normalized) || name.includes("ＮＡＳＤＡＱ１００")) return "DAIWA_NDX";
  if (/SBI/i.test(normalized) && /全世界/.test(name)) return "SBI_WORLD";
  return name.slice(0, 8);
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') { inQuotes = !inQuotes; }
    else if (ch === "," && !inQuotes) { result.push(current.trim()); current = ""; }
    else { current += ch; }
  }
  result.push(current.trim());
  return result;
}

function cleanNum(s: string): number {
  return parseFloat(s.replace(/"/g, "").replace(/,/g, "").replace(/--/g, "0").trim()) || 0;
}

function parseSbiCsv(text: string): { rows: CsvRow[]; format: CsvFormat } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  const headerIdx = lines.findIndex(
    (l) => l.includes("国内約定日") || l.includes("約定日,銘柄") || /約定日.*銘柄/.test(l)
  );
  if (headerIdx === -1) throw new Error("SBI証券のCSVフォーマットを認識できませんでした");
  const isFormatA = lines[headerIdx].includes("国内約定日");
  const parsed: CsvRow[] = [];

  for (const line of lines.slice(headerIdx + 1)) {
    const cols = parseCsvLine(line);
    if (cols.length < 4) continue;

    if (isFormatA) {
      const date = parseSbiDate(cols[0]);
      const bankName = cols[2] ?? "";
      const ticker = extractTickerFromSbi(bankName);
      const action: "buy" | "sell" = (cols[3] ?? "").includes("売") ? "sell" : "buy";
      const quantity = cleanNum(cols[5] ?? "0");
      const priceUsd = cleanNum(cols[6] ?? "0");
      const deliveryAmount = cleanNum(cols[8] ?? "0");
      let exchangeRate = 150;
      if (quantity > 0 && priceUsd > 0) {
        const calc = Math.round(deliveryAmount / (quantity * priceUsd));
        if (calc >= 50 && calc <= 300) exchangeRate = calc;
      }
      parsed.push({ date, ticker, name: bankName, action, quantity, price_usd: priceUsd, exchange_rate: exchangeRate, note: "SBI証券インポート" });
    } else {
      // Format B: 投資信託
      // 約定数量(口) × 約定単価(¥/万口) ÷ 10000 = 評価額(¥)
      const date = parseSbiDate(cols[0]);
      const fundName = cols[1] ?? "";
      const ticker = mapFundTicker(fundName);
      const action: "buy" | "sell" = (cols[4] ?? "").includes("解約") || (cols[4] ?? "").includes("売") ? "sell" : "buy";
      const quantity = cleanNum(cols[8] ?? "0");  // 約定数量（口）
      const navPer10k = cleanNum(cols[9] ?? "0"); // 約定単価（¥/万口）
      parsed.push({ date, ticker, name: fundName, action, quantity, price_usd: navPer10k, exchange_rate: 1, note: "SBI証券インポート（投信）" });
    }
  }
  return { rows: parsed, format: isFormatA ? "sbi_foreign" : "sbi_fund" };
}

function parseGenericCsv(text: string): CsvRow[] {
  const lines = text.trim().split("\n");
  if (lines.length < 2) return [];
  return lines.slice(1).map((l) => {
    const c = l.split(",").map((s) => s.trim());
    const action: "buy" | "sell" = c[3] === "sell" ? "sell" : "buy";
    return { date: c[0], ticker: c[1], name: c[2] ?? "", action, quantity: parseFloat(c[4]) || 0, price_usd: parseFloat(c[5]) || 0, exchange_rate: parseFloat(c[6]) || 150, note: c[7] ?? "" };
  }).filter((r) => r.quantity > 0);
}

function CsvImport({
  users, accounts, onError, onImported,
}: {
  users: UserRow[];
  accounts: InvestmentAccountRow[];
  onError: (e: string | null) => void;
  onImported: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<CsvRow[] | null>(null);
  const [detectedFormat, setDetectedFormat] = useState<CsvFormat>("generic");
  const [userId, setUserId] = useState(users[0]?.id ?? "");
  const [selectedAccountId, setSelectedAccountId] = useState(accounts[0]?.id ?? "");
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ ok: number; skipped: number; errors: string[] } | null>(null);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    onError(null);
    const reader = new FileReader();
    reader.onload = () => {
      const buffer = reader.result as ArrayBuffer;
      let text: string;
      try { text = new TextDecoder("shift-jis").decode(buffer); }
      catch { text = new TextDecoder("utf-8").decode(buffer); }
      const isSbi = text.includes("国内約定日") || text.includes("約定日,銘柄") || /約定日.*銘柄/.test(text);
      try {
        if (isSbi) {
          const { rows: parsed, format } = parseSbiCsv(text);
          if (parsed.length === 0) { onError("CSVにデータがありません。"); return; }
          setRows(parsed); setDetectedFormat(format);
        } else {
          const parsed = parseGenericCsv(new TextDecoder("utf-8").decode(buffer));
          if (parsed.length === 0) { onError("CSVにデータがありません。"); return; }
          setRows(parsed); setDetectedFormat("generic");
        }
        setResult(null);
      } catch (err: unknown) {
        onError(err instanceof Error ? err.message : "CSVのパースに失敗しました。");
      }
    };
    reader.readAsArrayBuffer(file);
  }

  async function doImport() {
    if (!rows || !userId || !selectedAccountId) { onError("ユーザーと口座を選択してください。"); return; }
    setImporting(true); onError(null);
    try {
      const res = await bulkRecordTrades(rows.map((r) => ({ ...r, user_id: userId, account_id: selectedAccountId, name: r.name || undefined, note: r.note || undefined })));
      setResult(res);
      if (res.ok > 0) { setRows(null); onImported(); }
    } catch (err: unknown) { onError(err instanceof Error ? err.message : String(err)); }
    setImporting(false);
  }

  const formatLabel: Record<CsvFormat, string> = { generic: "汎用CSV", sbi_foreign: "SBI証券（外国株）", sbi_fund: "SBI証券（投資信託）" };

  return (
    <div className="mt-4 border-t pt-4">
      <input type="file" accept=".csv" className="hidden" ref={fileRef} onChange={handleFile} />
      <button className="btn-ghost text-sm" onClick={() => fileRef.current?.click()}>📂 CSVインポート</button>
      <p className="text-xs text-muted-foreground mt-1">SBI証券CSV（Shift-JIS対応）または汎用CSV</p>

      {rows && (
        <div className="mt-3">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <span className="text-sm">ユーザー:</span>
            <select
              className="input w-auto"
              value={userId}
              onChange={(e) => {
                const newUser = e.target.value;
                setUserId(newUser);
                const firstForUser = accounts.find((a) => a.user_id === newUser);
                if (firstForUser) setSelectedAccountId(firstForUser.id);
              }}
            >
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
            <span className="text-sm">口座:</span>
            <select className="input w-auto" value={selectedAccountId} onChange={(e) => setSelectedAccountId(e.target.value)}>
              {(() => {
                const owned = accounts.filter((a) => a.user_id === userId);
                if (owned.length === 0) return <option value="">口座なし</option>;
                return owned.map((a) => <option key={a.id} value={a.id}>{a.account_name}</option>);
              })()}
            </select>
            <span className={clsx("chip text-xs", detectedFormat === "generic" ? "bg-muted" : "bg-primary/15 text-primary")}>{formatLabel[detectedFormat]}</span>
          </div>
          <div className="overflow-x-auto max-h-48">
            <table className="text-xs w-full">
              <thead><tr className="text-muted-foreground"><th className="text-left">日付</th><th>銘柄</th><th>名称</th><th>売買</th><th className="text-right">数量</th><th className="text-right">単価</th><th className="text-right">為替</th></tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-t">
                    <td>{r.date}</td>
                    <td className="font-mono">{r.ticker}</td>
                    <td className="max-w-[120px] truncate text-muted-foreground">{r.name}</td>
                    <td className={r.action === "buy" ? "text-destructive" : "text-success"}>{r.action === "buy" ? "買" : "売"}</td>
                    <td className="text-right">{r.quantity.toLocaleString("ja-JP")}</td>
                    <td className="text-right">{formatPrice(r.price_usd, r.ticker, true)}</td>
                    <td className="text-right">{r.exchange_rate === 1 ? "¥1(JPY)" : `¥${r.exchange_rate}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex gap-2 mt-2">
            <button className="btn-primary text-sm" onClick={doImport} disabled={importing}>
              {importing ? "インポート中..." : `確定してインポート (${rows.length}件)`}
            </button>
            <button className="btn-ghost text-sm" onClick={() => setRows(null)}>キャンセル</button>
          </div>
        </div>
      )}
      {result && (
        <p className="text-sm mt-2">
          ✅ {result.ok}件インポート
          {result.skipped > 0 && ` / ⏭ ${result.skipped}件スキップ（重複）`}
          {result.errors.length > 0 && ` / ❌ ${result.errors.length}件エラー`}
        </p>
      )}
    </div>
  );
}
