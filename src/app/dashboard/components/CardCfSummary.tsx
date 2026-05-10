"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { PaymentMethodRow, TransactionRow, UserRow } from "@/lib/types";
import { yen, todayIso } from "@/lib/format";
import { computeBilling, formatDayOfMonth } from "@/lib/paymentSchedule";
import { buildUserColorMap, userColor } from "@/lib/userColors";

/**
 * Per-credit-card summary of the next two upcoming bank withdrawals.
 *
 * For each card we compute its actual payment_day in the next few months,
 * pick the first two that are >= today, and sum the transactions whose
 * billing settlementDate matches each. Income on a card is excluded — it's
 * treated as same-day cash by the cash-flow projection, so excluding it
 * here keeps the two views consistent.
 */
export default function CardCfSummary({
  users,
  transactions,
  paymentMethods,
}: {
  users: UserRow[];
  transactions: TransactionRow[];
  paymentMethods: PaymentMethodRow[];
}) {
  const userById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
  const userColors = useMemo(() => buildUserColorMap(users), [users]);
  const cards = useMemo(
    () => paymentMethods.filter((m) => m.type === "credit_card" && !m.archived),
    [paymentMethods]
  );

  const today = todayIso();

  const summaries = useMemo(() => {
    return cards.map((card) => {
      const settles = nextSettlementDates(card, today, 2);
      const sums = settles.map(() => 0);
      for (const t of transactions) {
        if (t.payment_method_id !== card.id) continue;
        if (t.category_type === "transfer_in" || t.category_type === "transfer_out") continue;
        if (t.category_type === "income") continue;
        const { settlementDate } = computeBilling(t.date, card);
        const idx = settles.indexOf(settlementDate);
        if (idx >= 0) sums[idx] += t.amount;
      }
      return { card, settles, sums };
    });
  }, [cards, transactions, today]);

  if (cards.length === 0) {
    return (
      <section className="card">
        <h2 className="font-semibold mb-1">クレジットカード CF</h2>
        <p className="text-xs text-muted-foreground mb-3">
          クレジットカードを登録して締め日・支払日を入れると、各カードの引落予定とキャッシュフロー予測が表示されます。
        </p>
        <Link href="/settings?tab=payments" className="btn-primary text-sm inline-block">
          支払方法を設定する
        </Link>
      </section>
    );
  }

  return (
    <section className="card">
      <h2 className="font-semibold mb-1">クレジットカード CF</h2>
      <p className="text-xs text-muted-foreground mb-3">
        各カードの実際の引落日ごとの予定額。締め日・支払日は設定で編集できます。
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {summaries.map(({ card, settles, sums }) => {
          const owner = card.user_id ? userById.get(card.user_id) : null;
          const ownerName = owner?.name ?? "共同";
          const colors = userColor(userColors, card.user_id);
          return (
            <div key={card.id} className="rounded-xl border border-border p-3 space-y-2">
              <div>
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-semibold truncate">{card.name}</span>
                  <span
                    className="chip border text-[10px] py-0 px-2 shrink-0"
                    style={{
                      backgroundColor: colors.bg,
                      color: colors.text,
                      borderColor: colors.border,
                    }}
                  >
                    {ownerName}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  締め日 {formatDayOfMonth(card.closing_day)} / 支払日 {formatDayOfMonth(card.payment_day)}
                  {card.payment_month_offset !== 1 && ` (${card.payment_month_offset}ヶ月後)`}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <SettleCell label="次回引落予定" date={settles[0] ?? null} amount={sums[0] ?? 0} />
                <SettleCell label="次々回引落予定" date={settles[1] ?? null} amount={sums[1] ?? 0} />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function SettleCell({ label, date, amount }: { label: string; date: string | null; amount: number }) {
  return (
    <div>
      <div className="text-muted-foreground">
        {label}
        {date && <span className="ml-1 text-[10px]">({date.slice(5)})</span>}
      </div>
      <div className="font-bold tabular-nums">{date ? yen(amount) : "—"}</div>
    </div>
  );
}

/**
 * Compute the next N bank-withdrawal dates for a credit card, starting
 * from `today` (inclusive — money about to leave today still counts as
 * "next"). Returns YYYY-MM-DD strings.
 */
function nextSettlementDates(card: PaymentMethodRow, today: string, n: number): string[] {
  if (card.payment_day == null) return [];
  const out: string[] = [];
  const [yStr, mStr] = today.split("-");
  let y = Number(yStr);
  let m = Number(mStr); // 1..12
  // Look up to 12 months ahead — more than enough to find 2 future dates.
  for (let i = 0; i < 12 && out.length < n; i++) {
    const lastDay = new Date(y, m, 0).getDate();
    const day = Math.min(card.payment_day, lastDay);
    const settle = `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (settle >= today) out.push(settle);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}
