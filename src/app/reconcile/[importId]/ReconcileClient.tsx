"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  acceptMatch,
  archiveImport,
  bulkAcceptHighConfidence,
  bulkAcceptFxMatches,
  bulkCreateFamilyCard,
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

const TXN_KIND_LABEL: Record<TxnKind, string> = {
  variable: "変動費",
  fixed: "固定費",
  personal: "個人",
  special: "特別費",
  loan: "ローン",
  income: "収入",
  transfer_in: "振替入金",
  transfer_out: "振替出金",
  investment: "投資",
};

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
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [showLegend, setShowLegend] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StagingRow["status"] | "all">("all");

  const fmtBanner = searchParams?.get("fmt") ?? null;

  const paymentMethod = paymentMethods.find((p) => p.id === importRow.payment_method_id);
  const pmName = paymentMethod?.name ?? "(支払方法不明)";

  // Default user for family-card rows. Priority:
  //   1. payment_methods.family_card_user_id (explicit pin in settings)
  //   2. Any non-owner household member (typical 2-person household)
  //   3. First user (single-member household — no spouse)
  const familyDefaultUserId = useMemo(() => {
    if (users.length === 0) return null;
    const pinned = (paymentMethod as PaymentMethodRow | undefined)?.family_card_user_id ?? null;
    if (pinned && users.some((u) => u.id === pinned)) return pinned;
    const owner = paymentMethod?.user_id ?? null;
    const other = users.find((u) => u.id !== owner);
    return (other ?? users[0]).id;
  }, [users, paymentMethod]);
  const familyUser = familyDefaultUserId
    ? users.find((u) => u.id === familyDefaultUserId) ?? null
    : null;

  const txnById = useMemo(() => new Map(transactions.map((t) => [t.id, t])), [transactions]);

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

  const stats = useMemo(() => {
    let confirmed = 0, suggested = 0, unmatched = 0, created = 0, ignored = 0, familyUnmatched = 0, fxSuggested = 0;
    for (const r of stagingRows) {
      if (r.status === "confirmed") confirmed++;
      else if (r.status === "suggested") {
        suggested++;
        const matched = r.matched_transaction_id ? txnById.get(r.matched_transaction_id) : null;
        if (matched?.fx_status === "pending") fxSuggested++;
      }
      else if (r.status === "unmatched") {
        unmatched++;
        if (r.cardholder === "family") familyUnmatched++;
      }
      else if (r.status === "created") created++;
      else if (r.status === "ignored") ignored++;
    }
    return { confirmed, suggested, unmatched, created, ignored, familyUnmatched, fxSuggested };
  }, [stagingRows, txnById]);

  const claimedTxnIds = new Set(stagingRows.map((r) => r.matched_transaction_id).filter(Boolean) as string[]);
  const orphanTxns = transactions.filter((t) => !claimedTxnIds.has(t.id) && !t.statement_row_id);

  const visibleRows = useMemo(() => {
    if (statusFilter === "all") return stagingRows;
    return stagingRows.filter((r) => r.status === statusFilter);
  }, [stagingRows, statusFilter]);

  function refresh() {
    router.refresh();
  }

  function withErr(fn: () => Promise<unknown>) {
    return () =>
      startTransition(async () => {
        setErr(null);
        try {
          const result = (await fn()) as { importDeleted?: boolean } | undefined;
          if (result?.importDeleted) {
            router.push("/reconcile");
            return;
          }
          refresh();
        } catch (e) {
          setErr(e instanceof Error ? e.message : String(e));
        }
      });
  }

  return (
    <div className="space-y-3">
      <header className="card space-y-2">
        <h1 className="text-lg font-bold tracking-tight">{pmName}</h1>
        <p className="text-xs text-muted-foreground">
          {importRow.period_start ?? "?"} 〜 {importRow.period_end ?? "?"} ・ {formatFormat(importRow.parser)}
          {importRow.source_filename && ` ・ ${importRow.source_filename}`}
        </p>
        {familyUser && (
          <p className="text-xs rounded-md border border-primary/30 bg-primary/10 text-primary px-2 py-1 inline-block">
            👨‍👩‍👧 「家族」明細は <b>{familyUser.name}</b> の個人支出として作成されます
          </p>
        )}
        {fmtBanner === "learned" && (
          <p className="text-xs rounded-md border border-primary/30 bg-primary/10 text-primary px-2 py-1 inline-block">
            🎓 このカードのフォーマットを学習しました。
          </p>
        )}
        {fmtBanner === "remembered" && (
          <p className="text-xs rounded-md border border-success/30 bg-success/10 text-success px-2 py-1 inline-block">
            ✓ 学習済みフォーマットで取り込みました。
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <FilterPill label="全部" count={stagingRows.length} active={statusFilter === "all"} onClick={() => setStatusFilter("all")} tone="muted" />
          <FilterPill label="一致" count={stats.confirmed} active={statusFilter === "confirmed"} onClick={() => setStatusFilter("confirmed")} tone="success" />
          <FilterPill label="候補" count={stats.suggested} active={statusFilter === "suggested"} onClick={() => setStatusFilter("suggested")} tone="warn" />
          <FilterPill label="漏れ" count={stats.unmatched} active={statusFilter === "unmatched"} onClick={() => setStatusFilter("unmatched")} tone="danger" />
          <FilterPill label="作成済" count={stats.created} active={statusFilter === "created"} onClick={() => setStatusFilter("created")} tone="info" />
          <FilterPill label="無視" count={stats.ignored} active={statusFilter === "ignored"} onClick={() => setStatusFilter("ignored")} tone="muted" />
          {orphanTxns.length > 0 && (
            <Pill label={`余分 ${orphanTxns.length}`} tone="danger" />
          )}
          <button
            type="button"
            className="ml-auto text-xs underline text-muted-foreground"
            onClick={() => setShowLegend((v) => !v)}
            aria-expanded={showLegend}
          >
            {showLegend ? "凡例を閉じる" : "凡例とは？"}
          </button>
        </div>

        {showLegend && (
          <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs space-y-1 mt-1">
            <LegendItem label="一致" tone="success" desc="家計簿の取引とカードの明細が完全一致したもの。何もしなくてOK。" />
            <LegendItem label="候補" tone="warn" desc="日付と金額が近い候補が見つかったもの。タップで「採用 / 却下」を選んでください。" />
            <LegendItem label="漏れ" tone="danger" desc="家計簿に対応する取引が無い明細。タップで家計簿に新規追加してください。" />
            <LegendItem label="作成済" tone="info" desc="「漏れ」から家計簿に新規追加したもの。" />
            <LegendItem label="無視" tone="muted" desc="家計簿に登録しないと判断したもの。" />
            <LegendItem label="余分" tone="danger" desc="このカードで家計簿に登録されているが、明細に出てこない取引。二重登録の疑い。" />
          </div>
        )}

        <div className="flex flex-wrap gap-2 pt-2">
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
          {stats.familyUnmatched > 0 && familyDefaultUserId && (
            <button
              type="button"
              className="btn-secondary text-sm"
              disabled={pending}
              onClick={withErr(() =>
                bulkCreateFamilyCard({
                  importId: importRow.id,
                  user_id: familyDefaultUserId,
                }),
              )}
              title="家族カードの未照合行をすべて家族の個人支出として登録します"
            >
              家族カード分を個人支出で登録 ({stats.familyUnmatched})
            </button>
          )}
          {stats.fxSuggested > 0 && (
            <button
              type="button"
              className="btn-secondary text-sm"
              disabled={pending}
              onClick={withErr(() => bulkAcceptFxMatches({ importId: importRow.id }))}
              title="未確定 FX 取引に一致した候補を承認し、円額と為替レートを確定します"
            >
              ✈️ 旅行 FX を一括確定 ({stats.fxSuggested})
            </button>
          )}
          <button
            type="button"
            className="btn-secondary text-sm ml-auto"
            disabled={pending}
            onClick={() => {
              if (!confirm("このインポートを削除しますか？\n承認済みの家計簿取引は残ります。"))
                return;
              startTransition(async () => {
                setErr(null);
                try {
                  await archiveImport(importRow.id);
                  router.push("/reconcile");
                } catch (e) {
                  setErr(e instanceof Error ? e.message : String(e));
                }
              });
            }}
          >
            削除
          </button>
        </div>
        {err && (
          <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive mt-2">
            {err}
          </p>
        )}
      </header>

      <section className="space-y-2">
        {visibleRows.length === 0 && (
          <p className="text-sm text-muted-foreground px-2 py-4 text-center">該当する明細がありません</p>
        )}
        {visibleRows.map((r) => (
          <StagingCard
            key={r.id}
            row={r}
            txn={r.matched_transaction_id ? txnById.get(r.matched_transaction_id) ?? null : null}
            groupMembers={r.match_group_id ? groupSiblings.get(r.match_group_id) ?? null : null}
            users={users}
            categories={categories}
            familyDefaultUserId={familyDefaultUserId}
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
                  note_override: payload.note,
                }),
              )()
            }
          />
        ))}
      </section>

      {orphanTxns.length > 0 && (
        <section className="card">
          <h2 className="font-semibold mb-2">明細に無い家計簿の取引（余分の可能性）</h2>
          <p className="text-xs text-muted-foreground mb-2">
            この期間にこのカードで登録されているが、明細に対応行が無い取引です。重複入力、まだ計上されていない控えなどを確認してください。
          </p>
          <ul className="divide-y divide-border">
            {orphanTxns.map((t) => (
              <li key={t.id} className="py-2 flex items-baseline gap-2 text-sm">
                <span className="text-xs text-muted-foreground tabular-nums shrink-0">{t.date}</span>
                <span className="font-mono tabular-nums shrink-0">¥{t.amount.toLocaleString()}</span>
                <span className="truncate flex-1 min-w-0">{t.note ?? "—"}</span>
                <span className="text-xs text-muted-foreground shrink-0">{t.category_type}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function formatFormat(id: string): string {
  if (id.startsWith("pdf-")) return "PDF";
  if (id === "csv-auto") return "CSV";
  if (id === "amex" || id === "generic") return "CSV";
  if (id === "amex-pdf") return "PDF";
  return id;
}

/* ---------------------------------------------------------------------- */

function StagingCard({
  row, txn, groupMembers, users, categories, familyDefaultUserId, pending,
  onAccept, onReject, onIgnore, onCreate,
}: {
  row: StagingRow;
  txn: TxnRow | null;
  groupMembers: StagingRow[] | null;
  users: UserRow[];
  categories: CategoryRow[];
  familyDefaultUserId: string | null;
  pending: boolean;
  onAccept: () => void;
  onReject: () => void;
  onIgnore: () => void;
  onCreate: (p: { user_id: string; category_type: TxnKind; category_id: string | null; note: string }) => void;
}) {
  const [creating, setCreating] = useState(false);
  const isGroup = !!groupMembers && groupMembers.length >= 2;
  const groupSum = isGroup ? groupMembers!.reduce((s, m) => s + m.amount, 0) : 0;
  const otherCount = isGroup ? groupMembers!.length - 1 : 0;

  const isFamily = row.cardholder === "family";
  const defaultUserId = isFamily && familyDefaultUserId
    ? familyDefaultUserId
    : users[0]?.id ?? "";
  const defaultKind: TxnKind = isFamily ? "personal" : "variable";

  const merchantHasGarble = looksGarbled(row.merchant);
  const dimmed = row.status === "confirmed" || row.status === "created" || row.status === "ignored";

  return (
    <article className={`card !p-3 space-y-2 ${dimmed ? "opacity-75" : ""}`}>
      <div className="flex items-baseline gap-2">
        <span className="text-xs text-muted-foreground tabular-nums shrink-0">{row.date}</span>
        <span className="font-mono tabular-nums shrink-0 font-semibold text-base">¥{row.amount.toLocaleString()}</span>
        {isFamily && (
          <span className="chip bg-primary/15 text-primary text-[10px] shrink-0" title="家族カードの利用です">家族</span>
        )}
        <div className="ml-auto shrink-0">
          <StatusBadge status={row.status} confidence={row.match_confidence} />
        </div>
      </div>

      <div className="text-sm">
        <div className="break-all">{row.merchant || "—"}</div>
        {merchantHasGarble && (
          <div className="text-[11px] text-amber-700 bg-amber-500/10 border border-amber-500/30 rounded px-1.5 py-0.5 inline-block mt-1">
            ⚠ 文字化けの可能性あり。「追加」時に編集できます。
          </div>
        )}
      </div>

      {txn && (
        <div className="text-xs space-y-0.5 rounded-md bg-muted/30 border border-border px-2 py-1.5">
          <div className="text-muted-foreground">候補（家計簿）</div>
          <div>
            <span className="text-muted-foreground tabular-nums">{txn.date}</span>{" "}
            ¥{txn.amount.toLocaleString()} · {txn.note ?? "—"}
          </div>
          {isGroup && (
            <div className="text-[11px] text-amber-700 bg-amber-500/10 border border-amber-500/30 rounded px-1.5 py-0.5 inline-block">
              グループ {groupMembers!.length}件 = ¥{groupSum.toLocaleString()}
            </div>
          )}
        </div>
      )}

      <ActionRow
        row={row}
        isGroup={isGroup}
        otherCount={otherCount}
        pending={pending}
        creating={creating}
        onAccept={onAccept}
        onReject={onReject}
        onIgnore={onIgnore}
        onToggleCreate={() => setCreating((v) => !v)}
      />

      {creating && row.status === "unmatched" && (
        <div className="rounded-md bg-muted/40 border border-border p-3 mt-1">
          <CreateForm
            users={users}
            categories={categories}
            defaultUserId={defaultUserId}
            defaultKind={defaultKind}
            initialNote={row.merchant ?? ""}
            pending={pending}
            onSubmit={(p) => {
              onCreate(p);
              setCreating(false);
            }}
            onCancel={() => setCreating(false)}
          />
        </div>
      )}
    </article>
  );
}

function ActionRow({
  row, isGroup, otherCount, pending, creating,
  onAccept, onReject, onIgnore, onToggleCreate,
}: {
  row: StagingRow;
  isGroup: boolean;
  otherCount: number;
  pending: boolean;
  creating: boolean;
  onAccept: () => void;
  onReject: () => void;
  onIgnore: () => void;
  onToggleCreate: () => void;
}) {
  if (row.status === "suggested") {
    return (
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          className="btn-primary text-sm h-11"
          disabled={pending}
          onClick={onAccept}
          title={isGroup ? `このグループ ${otherCount + 1} 件を一括で採用` : undefined}
        >
          ✓ 採用{isGroup && ` (${otherCount + 1})`}
        </button>
        <button
          type="button"
          className="btn-secondary text-sm h-11"
          disabled={pending}
          onClick={onReject}
          title={isGroup ? `このグループ ${otherCount + 1} 件を一括で却下` : undefined}
        >
          ✗ 却下{isGroup && ` (${otherCount + 1})`}
        </button>
      </div>
    );
  }
  if (row.status === "unmatched") {
    return (
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          className="btn-primary text-sm h-11"
          disabled={pending}
          onClick={onToggleCreate}
        >
          {creating ? "閉じる" : "+ 家計簿に追加"}
        </button>
        <button
          type="button"
          className="btn-ghost text-sm h-11 border border-border"
          disabled={pending}
          onClick={onIgnore}
        >
          無視
        </button>
      </div>
    );
  }
  if (row.status === "confirmed") {
    return (
      <button
        type="button"
        className="btn-ghost text-sm h-10 w-full border border-border"
        disabled={pending}
        onClick={onReject}
      >
        解除{isGroup && ` (${otherCount + 1})`}
      </button>
    );
  }
  if (row.status === "ignored") {
    return (
      <button
        type="button"
        className="btn-ghost text-sm h-10 w-full border border-border"
        disabled={pending}
        onClick={onReject}
      >
        復帰
      </button>
    );
  }
  if (row.status === "created") {
    return <p className="text-xs text-muted-foreground">作成済</p>;
  }
  return null;
}

function CreateForm({
  users, categories, defaultUserId, defaultKind, initialNote, pending, onSubmit, onCancel,
}: {
  users: UserRow[];
  categories: CategoryRow[];
  defaultUserId: string;
  defaultKind: TxnKind;
  initialNote: string;
  pending: boolean;
  onSubmit: (p: { user_id: string; category_type: TxnKind; category_id: string | null; note: string }) => void;
  onCancel: () => void;
}) {
  const [userId, setUserId] = useState(defaultUserId);
  const [kind, setKind] = useState<TxnKind>(defaultKind);
  const [categoryId, setCategoryId] = useState<string>("");
  const [note, setNote] = useState(initialNote);
  const cats = categories.filter((c) =>
    kind === "personal" ? c.type === "personal" : c.type === "shared",
  );

  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          user_id: userId,
          category_type: kind,
          category_id: categoryId || null,
          note,
        });
      }}
    >
      <label className="block text-xs space-y-1">
        <span className="text-muted-foreground">店名（メモとして残ります、文字化けはここで直してください）</span>
        <input
          className="input text-sm"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="店名・内容"
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-xs space-y-1">
          <span className="text-muted-foreground">支払者</span>
          <select className="input text-sm h-10" value={userId} onChange={(e) => setUserId(e.target.value)} required>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </label>
        <label className="block text-xs space-y-1">
          <span className="text-muted-foreground">種類</span>
          <select className="input text-sm h-10" value={kind} onChange={(e) => setKind(e.target.value as TxnKind)}>
            {TXN_KINDS.map((k) => <option key={k} value={k}>{TXN_KIND_LABEL[k]}</option>)}
          </select>
        </label>
      </div>
      <label className="block text-xs space-y-1">
        <span className="text-muted-foreground">カテゴリ</span>
        <select className="input text-sm h-10" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">（未分類）</option>
          {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-2 pt-1">
        <button type="submit" className="btn-primary text-sm h-11" disabled={pending || !userId}>
          作成
        </button>
        <button type="button" className="btn-ghost text-sm h-11 border border-border" onClick={onCancel}>
          キャンセル
        </button>
      </div>
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

function FilterPill({
  label, count, active, onClick, tone,
}: { label: string; count: number; active: boolean; onClick: () => void; tone: PillTone }) {
  const cls: Record<PillTone, string> = {
    success: "border-success/30 text-success",
    warn:    "border-amber-500/30 text-amber-700",
    danger:  "border-destructive/30 text-destructive",
    info:    "border-primary/30 text-primary",
    muted:   "border-border text-muted-foreground",
  };
  const activeBg: Record<PillTone, string> = {
    success: "bg-success/15",
    warn:    "bg-amber-500/15",
    danger:  "bg-destructive/10",
    info:    "bg-primary/10",
    muted:   "bg-muted",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center px-2 py-1 rounded-full border text-xs h-7 ${cls[tone]} ${active ? activeBg[tone] : "bg-background"}`}
      aria-pressed={active}
    >
      {label} <span className="ml-1 tabular-nums">{count}</span>
    </button>
  );
}

function LegendItem({ label, tone, desc }: { label: string; tone: PillTone; desc: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <Pill label={label} tone={tone} />
      <span className="text-muted-foreground">{desc}</span>
    </div>
  );
}

/**
 * pdf2json's failure mode on AMEX Type3 fonts produces runs of
 * extended-Latin1 characters that read like keyboard noise (e.g. "ÏV§}|").
 * Heuristic: if the merchant has any non-kana char in U+0080..U+00FF, the
 * row probably has garbled bytes and the user should be invited to edit it.
 */
function looksGarbled(merchant: string | null): boolean {
  if (!merchant) return false;
  return /[\x80-\xa0¡-¿À-ÿ]/.test(merchant);
}
