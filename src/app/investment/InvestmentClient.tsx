"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import type {
  InvestmentAccountRow,
  InvestmentHoldingRow,
  InvestmentTransactionRow,
  UserRow,
} from "@/lib/types";
import { yen, todayIso, formatJaDate } from "@/lib/format";
import { searchStocks, getPriceUnit, getTickerCurrency, getTickerType, type StockItem } from "@/lib/stockList";
import { recordTrade, bulkRecordTrades, deleteInvestmentTransactions } from "../actions/investment";

type Props = {
  users: UserRow[];
  accounts: InvestmentAccountRow[];
  holdings: InvestmentHoldingRow[];
  trades: InvestmentTransactionRow[];
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

/** Compute holding value in JPY using live price if available. */
function holdingValueJpy(h: InvestmentHoldingRow, live?: LivePrice): number {
  const priceUnit = live?.priceUnit ?? getPriceUnit(h.ticker);
  const price = live?.price ?? h.current_price_usd;
  return Math.round((h.quantity * price) / priceUnit * h.exchange_rate);
}

function holdingCostJpy(h: InvestmentHoldingRow): number {
  const priceUnit = getPriceUnit(h.ticker);
  return Math.round((h.quantity * h.avg_cost_usd) / priceUnit * h.exchange_rate);
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
export default function InvestmentClient({ users, accounts, holdings, trades }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [bulkUpdating, setBulkUpdating] = useState(false);
  const [priceMap, setPriceMap] = useState<Map<string, LivePrice>>(new Map());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /* Selection mode state for trade history */
  const [selectMode, setSelectMode] = useState(false);
  const [selectedTradeIds, setSelectedTradeIds] = useState<Set<string>>(new Set());

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

  const avgRate = useMemo(() => {
    if (deduped.length === 0) return 150;
    const w = deduped.reduce((a, h) => a + holdingValueJpy(h, priceMap.get(h.ticker)), 0);
    const r = deduped.reduce((a, h) => a + h.exchange_rate * holdingValueJpy(h, priceMap.get(h.ticker)), 0);
    return w > 0 ? r / w : deduped[0].exchange_rate;
  }, [deduped, priceMap]);

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
    setBulkUpdating(false);
    if (fail > 0) setErr(`${ok} 銘柄更新 / ${fail} 失敗`);
  }, []); // stable — reads fresh data via holdingsRef

  /* Auto-fetch on mount + 5-minute refresh interval */
  useEffect(() => {
    bulkUpdatePrices();
    intervalRef.current = setInterval(() => {
      if (document.visibilityState !== "hidden") bulkUpdatePrices();
    }, 5 * 60 * 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [bulkUpdatePrices]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-bold">投資管理</h1>
        <div className="text-xs text-muted-foreground">
          為替レート（加重平均）: <strong>¥{avgRate.toFixed(2)} / USD</strong>
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
          <>
            <p className="py-2 text-muted-foreground text-sm">口座が未登録です。</p>
            <p className="mt-2 text-xs text-muted-foreground">証券口座は「設定」タブから追加できます。</p>
          </>
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
                <th className="sticky left-0 z-20 bg-card text-left whitespace-nowrap px-2 py-1.5 border-b border-r border-border">銘柄</th>
                <th className="text-right whitespace-nowrap px-2 py-1.5 border-b border-border">株数/口数</th>
                <th className="text-right whitespace-nowrap px-2 py-1.5 border-b border-border">平均取得単価</th>
                <th className="text-right whitespace-nowrap px-2 py-1.5 border-b border-border">現在価格</th>
                <th className="text-right whitespace-nowrap px-2 py-1.5 border-b border-border">評価額(円)</th>
                <th className="text-right whitespace-nowrap px-2 py-1.5 border-b border-border">損益(円)</th>
              </tr>
            </thead>
            <tbody>
              {deduped.map((h) => {
                const live = priceMap.get(h.ticker);
                const val = holdingValueJpy(h, live);
                const cost = holdingCostJpy(h);
                const gain = val - cost;
                const isFund = getPriceUnit(h.ticker) > 1;
                const livePrice = live?.price ?? h.current_price_usd;
                return (
                  <tr key={h.id}>
                    <td className="sticky left-0 z-10 bg-card px-2 py-1.5 text-xs whitespace-nowrap border-b border-r border-border">
                      <div className="font-mono text-[10px] text-muted-foreground leading-tight">{h.ticker}</div>
                      <div className="font-medium truncate max-w-[160px] leading-tight" title={h.name ?? "-"}>{h.name ?? "-"}</div>
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
        <TradeForm users={users} accounts={accounts} onError={setErr} pending={pending} start={start} />
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
          <h2 className="font-semibold">売買履歴</h2>
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
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px] border-separate border-spacing-0">
            <thead className="text-xs text-muted-foreground">
              <tr>
                {selectMode && <th className="bg-card w-10 px-2 py-1.5 border-b border-border"></th>}
                <th className="sticky left-0 z-20 bg-card text-left whitespace-nowrap px-2 py-1.5 border-b border-r border-border">銘柄</th>
                <th className="text-left whitespace-nowrap px-2 py-1.5 border-b border-border">日付</th>
                <th className="text-left whitespace-nowrap px-2 py-1.5 border-b border-border">口座</th>
                <th className="text-left whitespace-nowrap px-2 py-1.5 border-b border-border">売買</th>
                <th className="text-right whitespace-nowrap px-2 py-1.5 border-b border-border">数量</th>
                <th className="text-right whitespace-nowrap px-2 py-1.5 border-b border-border">単価</th>
                <th className="text-right whitespace-nowrap px-2 py-1.5 border-b border-border">金額(円)</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((t) => {
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
                      <span className="font-mono text-xs font-medium">{t.ticker}</span>
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
            </tbody>
          </table>
        </div>
      </section>

      {err && <p className="text-sm text-destructive">{err}</p>}
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
  users, accounts, onError, pending, start,
}: {
  users: UserRow[];
  accounts: InvestmentAccountRow[];
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
            await recordTrade({
              date: form.date,
              user_id: form.user_id,
              account_id: form.account_id || undefined,
              ticker: form.ticker,
              name: form.name || undefined,
              action: form.action,
              quantity: Number(form.quantity),
              price_usd: Number(form.price_usd),
              exchange_rate: Number(form.exchange_rate),
              note: form.note || undefined,
            });
            setForm({ ...form, ticker: "", name: "", quantity: "", price_usd: "", note: "" });
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
  const [result, setResult] = useState<{ ok: number; errors: string[] } | null>(null);

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
        <p className="text-sm mt-2">✅ {result.ok}件インポート {result.errors.length > 0 && `/ ❌ ${result.errors.length}件エラー`}</p>
      )}
    </div>
  );
}
