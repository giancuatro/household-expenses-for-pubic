"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  acceptMatch,
  archiveImport,
  bulkAcceptHighConfidence,
  createTransactionFromCard,
  ignoreCardRow,
  rejectMatch,
  runMatcher,
} from "@/app/actions/reconcile";
import type {
  CategoryRow,
  PaymentMethodRow,
  TxnKind,
  UserRow,
} from "@/lib/types";
import type { ImportRow, StagingRow, TxnRow } from "./page";

const TXN_KINDS: TxnKind[] = [
  "variable", "fixed", "personal", "special", "loan", "income",
  "transfer_in", "transfer_out", "investment",
];

interface Props {
  importRow: ImportRow;
  paymentMethods: PaymentMethodRow[];
  users: UserRow[];
  categories: CategoryRow[];
  stagingRows: StagingRow[];
  transactions: TxnRow[];
}

export default function ReconcileClient({
  importRow,
  paymentMethods,
  users,
  categories,
  stagingRows,
  transactions,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const pmName = paymentMethods.find((p) => p.id === importRow.payment_method_id)?.name ?? "(支払方法不明)";

  const txnById = useMemo(() => new Map(transactions.map((t) => [t.id, t])), [transactions]);

  // Group siblings together so each row knows its peers (the user wants to
  // see "this card row is part of a 3-row bundle that sums to ¥5,000").
  const groupSiblings = useMemo(() => {
    const map = new Map<string, StagingRow[]>();
    for (const r of stagingRows) {
      if (!r.match_group_id) continue;
      const arr = map.get(r.match_group_id) ?? [];
      arr.push(r);
      map.set(r.match_group_id, arr);
    }
    return map;
  }, [stagingRows]);

  // Derived counts for the summary bar.
  const stats = useMemo(() => {
    let confirmed = 0, suggested = 0, unmatched = 0, created = 0, ignored = 0;
    for (const r of stagingRows) {
      if (r.status === "confirmed") confirmed++;
      else if (r.status === "suggested") suggested++;
      else if (r.status === "unmatched") unmatched++;
      else if (r.status === "created") created++;
      else if (r.status === "ignored") ignored++;
    }
    return { confirmed, suggested, unmatched, created, ignored };
  }, [stagingRows]);

  // Transactions on this card+period that no card row claims = "余分" (orphan
  // app-side transaction, possibly a duplicate or refunded charge).
  const claimedTxnIds = new Set(stagingRows.map((r) => r.matched_transaction_id).filter(Boolean) as string[]);
  // Also exclude transactions already linked to a different statement row.
  const orphanTxns = transactions.filter((t) => !claimedTxnIds.has(t.id) && !t.statement_row_id);

  function refresh() {
    router.refresh();
  }

  function withErr(fn: () => Promise<unknown>) {
    return () =>
      startTransition(async () => {
        setErr(null);
        try {
          await fn();
          refresh();
        } catch (e) {
          setErr(e instanceof Error ? e.message : String(e));
        }
      });
  }

  return (
    <div className="space-y-4">
      <header className="card space-y-1">
        <h1 className="text-xl font-bold tracking-tight">{pmName}</h1>
        <p className="text-xs text-muted-foreground">
          {importRow.period_start ?? "?"} 〜 {importRow.period_end ?? "?"} ・ 形式: {formatFormat(importRow.parser)}
          {importRow.source_filename && ` ・ ${importRow.source_filename}`}
        </p>
        <div className="flex flex-wrap gap-3 pt-2 text-xs">
          <Pill label={`一致 ${stats.confirmed}`} tone="success" />
          <Pill label={`候補 ${stats.suggested}`} tone="warn" />
          <Pill label={`漏れ ${stats.unmatched}`} tone="danger" />
          <Pill label={`作成済 ${stats.created}`} tone="info" />
          <Pill label={`無視 ${stats.ignored}`} tone="muted" />
          <Pill label={`余分 ${orphanTxns.length}`} tone="danger" />
        </div>
        <div className="flex flex-wrap gap-2 pt-3">
          <button
            type="button"
            className="btn-secondary text-sm"
            disabled={pending}
            onClick={withErr(() => runMatcher(importRow.id))}
          >
            再マッチ
          </button>
          <button
            type="button"
            className="btn-secondary text-sm"
            disabled={pending || stats.suggested === 0}
            onClick={withErr(() =>
              bulkAcceptHighConfidence({ importId: importRow.id, minConfidence: 80 }),
            )}
          >
            候補を一括承認 (80+)
          </button>
          <button
            type="button"
            className="btn-secondary text-sm"
            disabled={pending}
            onClick={withErr(() => archiveImport(importRow.id))}
          >
            アーカイブ
          </button>
        </div>
        {err && (
          <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive mt-2">
            {err}
          </p>
        )}
      </header>

      <section className="card overflow-x-auto">
        <h2 className="font-semibold mb-2">明細（カード）→ 家計簿</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="py-2 pr-2">日付</th>
              <th className="py-2 pr-2">金額</th>
              <th className="py-2 pr-2">店名（カード）</th>
              <th className="py-2 pr-2">候補（家計簿）</th>
              <th className="py-2 pr-2">状態</th>
              <th className="py-2 pr-2">操作</th>
            </tr>
          </thead>
          <tbody>
            {stagingRows.map((r) => (
              <StagingTr
                key={r.id}
                row={r}
                txn={r.matched_transaction_id ? txnById.get(r.matched_transaction_id) ?? null : null}
                groupMembers={r.match_group_id ? groupSiblings.get(r.match_group_id) ?? null : null}
                users={users}
                categories={categories}
                pending={pending}
                onAccept={withErr(() => acceptMatch({ stagingId: r.id }))}
                onReject={withErr(() => rejectMatch({ stagingId: r.id }))}
                onIgnore={withErr(() => ignoreCardRow({ stagingId: r.id }))}
                onCreate={(payload) =>
                  withErr(() =>
                    createTransactionFromCard({
                      stagingId: r.id,
                      user_id: payload.user_id,
                      category_type: payload.category_type,
                      category_id: payload.category_id,
                    }),
                  )()
                }
              />
            ))}
          </tbody>
        </table>
      </section>

      {orphanTxns.length > 0 && (
        <section className="card overflow-x-auto">
          <h2 className="font-semibold mb-2">明細に無い家計簿の取引（余分の可能性）</h2>
          <p className="text-xs text-muted-foreground mb-2">
            この期間にこのカードで登録されているが、明細 CSV に対応行が無い取引です。重複入力や、まだ計上されていない控えのケースが多いので、カード側に出てこない理由を確認してください。
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="py-2 pr-2">日付</th>
                <th className="py-2 pr-2">金額</th>
                <th className="py-2 pr-2">メモ</th>
                <th className="py-2 pr-2">種別</th>
              </tr>
            </thead>
            <tbody>
              {orphanTxns.map((t) => (
                <tr key={t.id} className="border-b border-border last:border-0">
                  <td className="py-1 pr-2">{t.date}</td>
                  <td className="py-1 pr-2 font-mono">¥{t.amount.toLocaleString()}</td>
                  <td className="py-1 pr-2 truncate max-w-[40ch]">{t.note ?? "—"}</td>
                  <td className="py-1 pr-2 text-xs text-muted-foreground">{t.category_type}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

/** Render the internal parser id (csv-auto / pdf-auto) as a friendly format label. */
function formatFormat(id: string): string {
  if (id === "pdf-auto") return "PDF";
  if (id === "csv-auto") return "CSV";
  if (id === "amex" || id === "generic") return "CSV";
  if (id === "amex-pdf") return "PDF";
  return id;
}

/* ---------------------------------------------------------------------- */

function StagingTr({
  row, txn, groupMembers, users, categories, pending,
  onAccept, onReject, onIgnore, onCreate,
}: {
  row: StagingRow;
  txn: TxnRow | null;
  groupMembers: StagingRow[] | null;
  users: UserRow[];
  categories: CategoryRow[];
  pending: boolean;
  onAccept: () => void;
  onReject: () => void;
  onIgnore: () => void;
  onCreate: (p: { user_id: string; category_type: TxnKind; category_id: string | null }) => void;
}) {
  const [creating, setCreating] = useState(false);
  const isGroup = !!groupMembers && groupMembers.length >= 2;
  const groupSum = isGroup ? groupMembers!.reduce((s, m) => s + m.amount, 0) : 0;
  // Show "this row + N others" so each row is honest about how many siblings
  // would flip together if the user clicks 採用 / 却下.
  const otherCount = isGroup ? groupMembers!.length - 1 : 0;

  return (
    <>
      <tr className="border-b border-border last:border-0 align-top">
        <td className="py-1 pr-2">{row.date}</td>
        <td className="py-1 pr-2 font-mono">¥{row.amount.toLocaleString()}</td>
        <td className="py-1 pr-2 truncate max-w-[28ch]">{row.merchant || "—"}</td>
        <td className="py-1 pr-2">
          {txn ? (
            <div className="text-xs space-y-0.5">
              <div>
                <span className="text-muted-foreground">{txn.date}</span>{" "}
                ¥{txn.amount.toLocaleString()} · {txn.note ?? "—"}
              </div>
              {isGroup && (
                <div className="text-[11px] text-amber-700 bg-amber-500/10 border border-amber-500/30 rounded px-1.5 py-0.5 inline-block">
                  グループ {groupMembers!.length}件: {groupMembers!.map((m) => `¥${m.amount.toLocaleString()}`).join(" + ")} = ¥{groupSum.toLocaleString()}
                </div>
              )}
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          )}
        </td>
        <td className="py-1 pr-2">
          <StatusBadge status={row.status} confidence={row.match_confidence} />
        </td>
        <td className="py-1 pr-2 space-x-1 whitespace-nowrap">
          {row.status === "suggested" && (
            <>
              <button
                className="btn-secondary text-xs"
                disabled={pending}
                onClick={onAccept}
                title={isGroup ? `このグループ ${otherCount + 1} 件を一括で採用` : undefined}
              >
                採用{isGroup && ` (${otherCount + 1}件)`}
              </button>
              <button
                className="btn-secondary text-xs"
                disabled={pending}
                onClick={onReject}
                title={isGroup ? `このグループ ${otherCount + 1} 件を一括で却下` : undefined}
              >
                却下{isGroup && ` (${otherCount + 1}件)`}
              </button>
            </>
          )}
          {row.status === "unmatched" && (
            <>
              <button className="btn-secondary text-xs" disabled={pending} onClick={() => setCreating((v) => !v)}>
                {creating ? "閉じる" : "+ 家計簿に追加"}
              </button>
              <button className="btn-secondary text-xs" disabled={pending} onClick={onIgnore}>無視</button>
            </>
          )}
          {row.status === "confirmed" && (
            <button className="btn-secondary text-xs" disabled={pending} onClick={onReject}>
              解除{isGroup && ` (${otherCount + 1}件)`}
            </button>
          )}
          {row.status === "ignored" && (
            <button className="btn-secondary text-xs" disabled={pending} onClick={onReject}>復帰</button>
          )}
          {row.status === "created" && <span className="text-xs text-muted-foreground">作成済</span>}
        </td>
      </tr>
      {creating && row.status === "unmatched" && (
        <tr className="border-b border-border last:border-0">
          <td colSpan={6} className="py-2 px-2 bg-muted/40">
            <CreateForm
              users={users}
              categories={categories}
              pending={pending}
              onSubmit={(p) => {
                onCreate(p);
                setCreating(false);
              }}
            />
          </td>
        </tr>
      )}
    </>
  );
}

function CreateForm({
  users, categories, pending, onSubmit,
}: {
  users: UserRow[];
  categories: CategoryRow[];
  pending: boolean;
  onSubmit: (p: { user_id: string; category_type: TxnKind; category_id: string | null }) => void;
}) {
  const [userId, setUserId] = useState(users[0]?.id ?? "");
  const [kind, setKind] = useState<TxnKind>("variable");
  const [categoryId, setCategoryId] = useState<string>("");
  const cats = categories.filter((c) =>
    kind === "personal" ? c.type === "personal" : c.type === "shared",
  );

  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          user_id: userId,
          category_type: kind,
          category_id: categoryId || null,
        });
      }}
    >
      <label className="text-xs space-y-1">
        <span>支払者</span>
        <select className="input text-xs" value={userId} onChange={(e) => setUserId(e.target.value)} required>
          {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
      </label>
      <label className="text-xs space-y-1">
        <span>種類</span>
        <select className="input text-xs" value={kind} onChange={(e) => setKind(e.target.value as TxnKind)}>
          {TXN_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
      </label>
      <label className="text-xs space-y-1">
        <span>カテゴリ</span>
        <select className="input text-xs" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">（未分類）</option>
          {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      <button type="submit" className="btn-primary text-xs" disabled={pending || !userId}>
        作成
      </button>
    </form>
  );
}

function StatusBadge({
  status, confidence,
}: { status: StagingRow["status"]; confidence: number | null }) {
  const map: Record<StagingRow["status"], { label: string; tone: PillTone }> = {
    confirmed: { label: "✓ 一致", tone: "success" },
    suggested: { label: `? 候補 ${confidence ?? ""}`, tone: "warn" },
    unmatched: { label: "⚠ 漏れ", tone: "danger" },
    created:   { label: "+ 作成済", tone: "info" },
    ignored:   { label: "無視", tone: "muted" },
  };
  const { label, tone } = map[status];
  return <Pill label={label} tone={tone} />;
}

type PillTone = "success" | "warn" | "danger" | "info" | "muted";
function Pill({ label, tone }: { label: string; tone: PillTone }) {
  const cls: Record<PillTone, string> = {
    success: "bg-success/15 text-success border-success/30",
    warn:    "bg-amber-500/15 text-amber-700 border-amber-500/30",
    danger:  "bg-destructive/10 text-destructive border-destructive/30",
    info:    "bg-primary/10 text-primary border-primary/30",
    muted:   "bg-muted text-muted-foreground border-border",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-xs ${cls[tone]}`}>
      {label}
    </span>
  );
}
