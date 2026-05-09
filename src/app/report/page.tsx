import Link from "next/link";
import {
  listCategories,
  listFixedCostMasters,
  listTransactionsForMonth,
  listUsers,
} from "@/lib/queries";
import { addMonths, monthKey, monthDateRange, yen, formatJaMonth } from "@/lib/format";
import { getSupabaseServer } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth";
import { getPriceUnit } from "@/lib/stockList";
import clsx from "clsx";
import type { TransactionRow } from "@/lib/types";
import { computeBreakdown } from "@/lib/balance";
import MonthSelector from "./MonthSelector";
import InfoTip from "./InfoTip";

export const dynamic = "force-dynamic";

export default async function ReportPage({
  searchParams,
}: {
  searchParams: { m?: string };
}) {
  const ym = /^\d{4}-\d{2}$/.test(searchParams.m ?? "") ? searchParams.m! : monthKey();

  const { household } = await requireSession();
  const hid = household.household_id;
  const { start: mStart, end: mEnd } = monthDateRange(ym);
  const sb = getSupabaseServer();

  const [users, categories, txns, prevTxns, fixedCostMasters, allInvestTradesRes] = await Promise.all([
    listUsers(hid),
    listCategories(hid),
    listTransactionsForMonth(hid, ym),
    listTransactionsForMonth(hid, addMonths(ym, -1)),
    listFixedCostMasters(hid),
    sb
      .from("investment_transactions")
      .select("date, ticker, action, quantity, price_usd, exchange_rate, amount_jpy")
      .eq("household_id", hid)
      .order("date", { ascending: true }),
  ]);

  const allInvestTrades = allInvestTradesRes.data ?? [];
  const monthInvestTrades = allInvestTrades.filter((t) => t.date >= mStart && t.date <= mEnd);

  const investBuyTotal = monthInvestTrades.filter((t) => t.action === "buy").reduce((a, t) => a + t.amount_jpy, 0);
  const investSellTotal = monthInvestTrades.filter((t) => t.action === "sell").reduce((a, t) => a + t.amount_jpy, 0);
  const investNet = investSellTotal - investBuyTotal;

  // 当月の売却による実現損益を計算（全履歴から平均取得単価を追跡）
  const positions = new Map<string, { qty: number; totalCost: number }>();
  let realizedGainThisMonth = 0;
  for (const t of allInvestTrades) {
    const priceUnit = getPriceUnit(t.ticker);
    const pos = positions.get(t.ticker) ?? { qty: 0, totalCost: 0 };
    if (t.action === "buy") {
      pos.qty += t.quantity;
      pos.totalCost += t.quantity * t.price_usd;
    } else {
      const avgCost = pos.qty > 0 ? pos.totalCost / pos.qty : t.price_usd;
      if (t.date >= mStart && t.date <= mEnd) {
        const gainNative = (t.price_usd - avgCost) * t.quantity;
        realizedGainThisMonth += Math.round((gainNative / priceUnit) * t.exchange_rate);
      }
      const sellQty = Math.min(t.quantity, pos.qty);
      const newQty = Math.max(0, pos.qty - sellQty);
      pos.totalCost = pos.qty > 0 ? pos.totalCost * (newQty / pos.qty) : 0;
      pos.qty = newQty;
    }
    positions.set(t.ticker, pos);
  }

  const sharedCats = categories.filter((c) => c.type === "shared" && c.is_active);
  const personalCats = categories.filter((c) => c.type === "personal" && c.is_active);

  const sum = (arr: TransactionRow[]) => arr.reduce((a, t) => a + t.amount, 0);
  const nonAdvance = txns.filter((t) => !t.is_advance_payment);

  // Shared variable by category (display only)
  const sharedRows = sharedCats.map((c) => {
    const spent = sum(
      nonAdvance.filter((t) => t.category_type === "variable" && t.category_id === c.id)
    );
    return { c, spent, remaining: c.budget_amount - spent };
  });
  const sharedVarBudget = sharedRows.reduce((a, r) => a + r.c.budget_amount, 0);

  // Apportioned breakdown (current and previous month)
  const breakdown = computeBreakdown(users, txns, fixedCostMasters);
  const prevBreakdown = computeBreakdown(users, prevTxns, fixedCostMasters);
  const { sharedVarTotal, loanTotal, sharedFixedTotal, sharedExpenseTotal, specialOut } = breakdown;
  const fixedTotal = sharedFixedTotal; // shared fixed only (display)

  // Special advance — excluded from net (legacy display)
  const advanceIn = sum(
    txns.filter((t) => t.is_advance_payment && t.category_type === "income")
  );
  const advanceOut = sum(
    txns.filter((t) => t.is_advance_payment && t.category_type !== "income")
  );

  // Personal per user (rows for display + personal fixed from breakdown)
  const personalByUser = users.map((u) => {
    const rows = personalCats.map((c) => {
      const spent = sum(
        nonAdvance.filter(
          (t) => t.user_id === u.id && t.category_type === "personal" && t.category_id === c.id
        )
      );
      return { c, spent, remaining: c.budget_amount - spent };
    });
    const fixed = breakdown.perUser.get(u.id)?.personalFixed ?? 0;
    return { user: u, rows, fixed };
  });

  // Balance table — apportioned
  const N = Math.max(1, users.length);
  const balance = users.map((u) => {
    const cur = breakdown.perUser.get(u.id)!;
    const prev = prevBreakdown.perUser.get(u.id)!;
    return {
      user: u,
      income: cur.income,
      expense: cur.expense,
      net: cur.net,
      sharedShare: cur.sharedShare,
      specialShare: cur.specialShare,
      personal: cur.personal,
      personalFixed: cur.personalFixed,
      prevCarry: prev.net,
    };
  });

  // Per-person cost — include specialOut share per user request
  const perPersonAll = sharedExpenseTotal / N + specialOut / N;
  const perPersonVar = (sharedVarTotal + loanTotal) / N + specialOut / N;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-bold">{formatJaMonth(ym + "-01")} 月次レポート</h1>
        <div className="flex items-center gap-2">
          <MonthSelector currentMonth={ym} />
          <Link href={`/report?m=${addMonths(ym, -1)}`} className="btn-ghost text-sm">◀</Link>
          <Link href={`/report?m=${addMonths(ym, 1)}`} className="btn-ghost text-sm">▶</Link>
        </div>
      </div>

      {/* Shared */}
      <section className="card overflow-x-auto">
        <h2 className="font-semibold mb-3">共同出費</h2>
        <table className="w-full text-sm min-w-[480px] tabular-nums">
          <thead className="text-xs text-muted-foreground">
            <tr>
              <th className="text-left py-1">項目</th>
              <th className="text-right">支出</th>
              <th className="text-right">予算</th>
              <th className="text-right">残額</th>
            </tr>
          </thead>
          <tbody>
            {sharedRows.map(({ c, spent, remaining }) => (
              <tr
                key={c.id}
                className={clsx(
                  "border-t",
                  c.budget_amount > 0 && spent > c.budget_amount && "bg-destructive/10"
                )}
              >
                <td className="py-1">{c.name}</td>
                <td className="text-right">{yen(spent)}</td>
                <td className="text-right text-muted-foreground">{yen(c.budget_amount)}</td>
                <td
                  className={clsx(
                    "text-right",
                    remaining < 0 ? "text-destructive" : "text-muted-foreground"
                  )}
                >
                  {yen(remaining)}
                </td>
              </tr>
            ))}
            <tr className="border-t font-semibold">
              <td className="py-1">変動費 計</td>
              <td className="text-right">{yen(sharedVarTotal)}</td>
              <td className="text-right text-muted-foreground">{yen(sharedVarBudget)}</td>
              <td className="text-right">{yen(sharedVarBudget - sharedVarTotal)}</td>
            </tr>
            <tr className="border-t">
              <td className="py-1">ローン 計</td>
              <td className="text-right">{yen(loanTotal)}</td>
              <td colSpan={2}></td>
            </tr>
            <tr className="border-t">
              <td className="py-1">固定費 計</td>
              <td className="text-right">{yen(fixedTotal)}</td>
              <td colSpan={2}></td>
            </tr>
            <tr className="border-t font-bold">
              <td className="py-1">共同出費 計</td>
              <td className="text-right">{yen(sharedExpenseTotal)}</td>
              <td colSpan={2}></td>
            </tr>
          </tbody>
        </table>
      </section>

      {/* Special */}
      <section className="card">
        <h2 className="font-semibold mb-3">特別費（収支対象外）</h2>
        <div className="grid grid-cols-3 gap-3 text-sm">
          <div><div className="text-xs text-muted-foreground">立替収入</div><div>{yen(advanceIn)}</div></div>
          <div><div className="text-xs text-muted-foreground">立替支出</div><div>{yen(advanceOut)}</div></div>
          <div><div className="text-xs text-muted-foreground">特別支出</div><div>{yen(specialOut)}</div></div>
        </div>
      </section>

      {/* Investment */}
      {monthInvestTrades.length > 0 && (
        <section className="card">
          <h2 className="font-semibold mb-3">投資収支</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div>
              <div className="text-xs text-muted-foreground">購入（現金流出）</div>
              <div className="text-destructive font-medium">{yen(investBuyTotal)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">売却（現金流入）</div>
              <div className="text-success font-medium">{yen(investSellTotal)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">現金収支</div>
              <div className={clsx("font-semibold", investNet >= 0 ? "text-success" : "text-destructive")}>
                {investNet >= 0 ? "+" : ""}{yen(investNet)}
              </div>
            </div>
            {investSellTotal > 0 && (
              <div>
                <div className="text-xs text-muted-foreground">売却益（実現損益）</div>
                <div className={clsx("font-semibold", realizedGainThisMonth >= 0 ? "text-success" : "text-destructive")}>
                  {realizedGainThisMonth >= 0 ? "+" : ""}{yen(realizedGainThisMonth)}
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Personal */}
      <section className="grid md:grid-cols-2 gap-4">
        {personalByUser.map(({ user, rows, fixed }) => {
          const total = rows.reduce((a, r) => a + r.spent, 0) + fixed;
          return (
            <div key={user.id} className="card overflow-x-auto">
              <h2 className="font-semibold mb-3">{user.name} 個人出費</h2>
              <table className="w-full text-sm min-w-[420px] tabular-nums">
                <thead className="text-xs text-muted-foreground">
                  <tr>
                    <th className="text-left">項目</th>
                    <th className="text-right">支出</th>
                    <th className="text-right">予算</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ c, spent }) => (
                    <tr key={c.id} className="border-t">
                      <td className="py-1">{c.name}</td>
                      <td className="text-right">{yen(spent)}</td>
                      <td className="text-right text-muted-foreground">{yen(c.budget_amount)}</td>
                    </tr>
                  ))}
                  <tr className="border-t">
                    <td className="py-1">個人固定費</td>
                    <td className="text-right">{yen(fixed)}</td>
                    <td></td>
                  </tr>
                  <tr className="border-t font-bold">
                    <td className="py-1">計</td>
                    <td className="text-right">{yen(total)}</td>
                    <td></td>
                  </tr>
                </tbody>
              </table>
            </div>
          );
        })}
      </section>

      {/* Balance — card on mobile, table on md+ */}
      <section className="card">
        <h2 className="font-semibold mb-3">収支集計</h2>
        {/* Mobile: cards */}
        <div className="md:hidden space-y-3">
          {balance.map((b) => (
            <div key={b.user.id} className="rounded-xl border border-border p-3">
              <div className="font-semibold mb-1">{b.user.name}</div>
              <div className="grid grid-cols-3 gap-1 text-sm">
                <div><span className="text-xs text-muted-foreground">収入</span><div>{yen(b.income)}</div></div>
                <div>
                  <span className="text-xs text-muted-foreground">支出</span>
                  <InfoTip
                    title={`${b.user.name}の支出内訳`}
                    lines={[
                      { label: `共同出費 ÷ ${N}`, value: yen(b.sharedShare) },
                      { label: `特別支出 ÷ ${N}`, value: yen(b.specialShare) },
                      { label: "個人支出", value: yen(b.personal) },
                      { label: "個人固定費", value: yen(b.personalFixed) },
                    ]}
                    total={{ label: "計", value: yen(b.expense) }}
                  />
                  <div>{yen(b.expense)}</div>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">収支</span>
                  <div className={clsx("font-semibold", b.net >= 0 ? "text-success" : "text-destructive")}>{yen(b.net)}</div>
                </div>
              </div>
              <div className="flex items-center gap-2 text-sm mt-2">
                <div><span className="text-xs text-muted-foreground">前月繰越</span> {yen(b.prevCarry)}</div>
                <span className="text-muted-foreground/60">→</span>
                <div><span className="text-xs text-muted-foreground">翌月繰越</span> <strong>{yen(b.prevCarry + b.net)}</strong></div>
              </div>
            </div>
          ))}
        </div>
        {/* Desktop: table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm min-w-[480px] tabular-nums">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th className="text-left">ユーザー</th>
                <th className="text-right">収入</th>
                <th className="text-right">支出</th>
                <th className="text-right">収支</th>
                <th className="text-right">前月繰越</th>
                <th className="text-right">翌月繰越</th>
              </tr>
            </thead>
            <tbody>
              {balance.map((b) => (
                <tr key={b.user.id} className="border-t">
                  <td className="py-1">{b.user.name}</td>
                  <td className="text-right">{yen(b.income)}</td>
                  <td className="text-right whitespace-nowrap">
                    {yen(b.expense)}
                    <InfoTip
                      title={`${b.user.name}の支出内訳`}
                      lines={[
                        { label: `共同出費 ÷ ${N}`, value: yen(b.sharedShare) },
                        { label: `特別支出 ÷ ${N}`, value: yen(b.specialShare) },
                        { label: "個人支出", value: yen(b.personal) },
                        { label: "個人固定費", value: yen(b.personalFixed) },
                      ]}
                      total={{ label: "計", value: yen(b.expense) }}
                    />
                  </td>
                  <td className={clsx("text-right font-semibold", b.net >= 0 ? "text-success" : "text-destructive")}>
                    {yen(b.net)}
                  </td>
                  <td className="text-right text-muted-foreground">{yen(b.prevCarry)}</td>
                  <td className="text-right">{yen(b.prevCarry + b.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2 className="font-semibold mb-3">一人当たりコスト</h2>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <div className="text-xs text-muted-foreground flex items-center">
              全体
              <InfoTip
                title={`全体（÷ ${N}）`}
                lines={[
                  { label: `共同出費 ÷ ${N}`, value: yen(sharedExpenseTotal / N) },
                  { label: `特別支出 ÷ ${N}`, value: yen(specialOut / N) },
                ]}
                total={{ label: "計", value: yen(perPersonAll) }}
              />
            </div>
            <div className="text-lg font-bold">{yen(perPersonAll)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground flex items-center">
              固定費除く
              <InfoTip
                title={`固定費除く（÷ ${N}）`}
                lines={[
                  { label: `共同変動費 ÷ ${N}`, value: yen(sharedVarTotal / N) },
                  { label: `ローン ÷ ${N}`, value: yen(loanTotal / N) },
                  { label: `特別支出 ÷ ${N}`, value: yen(specialOut / N) },
                ]}
                total={{ label: "計", value: yen(perPersonVar) }}
              />
            </div>
            <div className="text-lg font-bold">{yen(perPersonVar)}</div>
          </div>
        </div>
      </section>
    </div>
  );
}
