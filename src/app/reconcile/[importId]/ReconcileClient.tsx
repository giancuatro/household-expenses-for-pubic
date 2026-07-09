"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  acceptMatch,
  archiveImport,
  bulkAcceptHighConfidence,
  bulkAcceptFxMatches,
  bulkCreateFamilyCard,
  bulkCreateFromSuggestions,
  createTransactionFromCard,
  ignoreCardRow,
  rejectMatch,
  runMatcher,
} from "@/app/actions/reconcile";
import { deleteTransaction } from "@/app/actions/transactions";
import { BalanceCheckSheet } from "@/components/BalanceCheckSheet";
import { toast } from "@/lib/toast";
import type {
  CategoryRow,
  PaymentMethodRow,
  TxnKind,
  UserRow,
} from "@/lib/types";
import type { AliasValue } from "@/lib/reconcile/merchantAlias";
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
  aliasSuggestions: Record<string, AliasValue>;
  duplicateWarnings: string[];
}

export default function ReconcileClient({
  importRow,
  paymentMethods,
  users,
  categories,
  stagingRows,
  transactions,
  aliasSuggestions,
  duplicateWarnings,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  // Local optimistic copy of the staging rows. Single-row actions mutate this
  // immediately and roll back on error; bulk actions fall through to a server
  // round-trip + router.refresh, which re-seeds this via the effect below.
  const [rows, setRows] = useState<StagingRow[]>(stagingRows);
  useEffect(() => setRows(stagingRows), [stagingRows]);

  const [removedOrphans, setRemovedOrphans] = useState<Set<string>>(new Set());
  const [balanceCheckOpen, setBalanceCheckOpen] = useState(false);
  const dupeSet = useMemo(() => new Set(duplicateWarnings), [duplicateWarnings]);

  const fmtBanner = searchParams?.get("fmt") ?? null;
  const paymentMethod = paymentMethods.find((p) => p.id === importRow.payment_method_id);
  const pmName = paymentMethod?.name ?? "(支払方法不明)";

  // Spouse resolution for the "妻の個人支出" one-tap (household convention):
  //   1. payment_methods.family_card_user_id  2. any non-owner member  3. users[0]
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
  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const userById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);

  const groupSiblings = useMemo(() => {
    const map = new Map<string, StagingRow[]>();
    for (const r of rows) {
      if (!r.match_group_id) continue;
      const arr = map.get(r.match_group_id) ?? [];
      arr.push(r);
      map.set(r.match_group_id, arr);
    }
    return map;
  }, [rows]);

  const stats = useMemo(() => {
    let confirmed = 0, suggested = 0, unmatched = 0, created = 0, ignored = 0, familyUnmatched = 0, fxSuggested = 0, aliasFillable = 0;
    for (const r of rows) {
      if (r.status === "confirmed") confirmed++;
      else if (r.status === "suggested") {
        suggested++;
        const matched = r.matched_transaction_id ? txnById.get(r.matched_transaction_id) : null;
        if (matched?.fx_status === "pending") fxSuggested++;
      } else if (r.status === "unmatched") {
        unmatched++;
        if (r.cardholder === "family") familyUnmatched++;
        if (r.merchant && aliasSuggestions[r.id]) aliasFillable++;
      } else if (r.status === "created") created++;
      else if (r.status === "ignored") ignored++;
    }
    return { confirmed, suggested, unmatched, created, ignored, familyUnmatched, fxSuggested, aliasFillable };
  }, [rows, txnById, aliasSuggestions]);

  const claimedTxnIds = new Set(rows.map((r) => r.matched_transaction_id).filter(Boolean) as string[]);
  const orphanTxns = transactions.filter(
    (t) => !claimedTxnIds.has(t.id) && !t.statement_row_id && !removedOrphans.has(t.id),
  );

  // Queue = rows still awaiting a decision, collapse group into a single card
  // (represented by its earliest member). Processed rows go to a <details>.
  const { queue, processed } = useMemo(() => {
    const seenGroups = new Set<string>();
    const queue: StagingRow[] = [];
    const processed: StagingRow[] = [];
    const sorted = [...rows].sort((a, b) => b.date.localeCompare(a.date));
    for (const r of sorted) {
      const active = r.status === "suggested" || r.status === "unmatched";
      if (active && r.match_group_id) {
        if (seenGroups.has(r.match_group_id)) continue;
        seenGroups.add(r.match_group_id);
      }
      if (active) queue.push(r);
      else processed.push(r);
    }
    return { queue, processed };
  }, [rows]);

  const total = rows.length;
  const remaining = queue.length;
  const done = total === 0 || remaining === 0;

  /* ----- Optimistic action plumbing ----- */

  function patchRows(mutate: (r: StagingRow) => StagingRow | null) {
    setRows((prev) => prev.map((r) => mutate(r) ?? r));
  }

  function runServer(fn: () => Promise<unknown>, rollback: StagingRow[]) {
    startTransition(async () => {
      try {
        const result = (await fn()) as { importDeleted?: boolean } | undefined;
        if (result?.importDeleted) {
          toast.success("突合が完了しました");
          router.push("/reconcile");
        }
      } catch (e) {
        setRows(rollback); // revert optimistic patch
        toast.error(e instanceof Error ? e.message : String(e));
      }
    });
  }

  function siblingIds(row: StagingRow): string[] {
    if (!row.match_group_id) return [row.id];
    return (groupSiblings.get(row.match_group_id) ?? [row]).map((r) => r.id);
  }

  function onAccept(row: StagingRow) {
    const snapshot = rows;
    const ids = new Set(siblingIds(row));
    patchRows((r) => (ids.has(r.id) ? { ...r, status: "confirmed" } : r));
    runServer(() => acceptMatch({ stagingId: row.id }), snapshot);
  }

  function onReject(row: StagingRow) {
    const snapshot = rows;
    const ids = new Set(siblingIds(row));
    patchRows((r) =>
      ids.has(r.id)
        ? { ...r, status: "unmatched", matched_transaction_id: null, match_confidence: null, match_group_id: null }
        : r,
    );
    runServer(() => rejectMatch({ stagingId: row.id }), snapshot);
  }

  function onIgnore(row: StagingRow) {
    const snapshot = rows;
    const ids = new Set(siblingIds(row));
    patchRows((r) => (ids.has(r.id) ? { ...r, status: "ignored" } : r));
    runServer(() => ignoreCardRow({ stagingId: row.id }), snapshot);
  }

  function onCreate(
    row: StagingRow,
    payload: { user_id: string; category_type: TxnKind; category_id: string | null; note?: string },
  ) {
    const snapshot = rows;
    // The created row → 'created'; any group siblings detach back to unmatched
    // (server does the same when a grouped row is turned into a standalone txn).
    patchRows((r) => {
      if (r.id === row.id) return { ...r, status: "created", matched_transaction_id: null, match_group_id: null };
      if (row.match_group_id && r.match_group_id === row.match_group_id) {
        return { ...r, status: "unmatched", matched_transaction_id: null, match_confidence: null, match_group_id: null };
      }
      return r;
    });
    runServer(
      () =>
        createTransactionFromCard({
          stagingId: row.id,
          user_id: payload.user_id,
          category_type: payload.category_type,
          category_id: payload.category_id,
          note_override: payload.note,
        }),
      snapshot,
    );
  }

  function onDeleteOrphan(txnId: string) {
    if (!confirm("この家計簿の取引を削除しますか？")) return;
    setRemovedOrphans((prev) => new Set(prev).add(txnId));
    startTransition(async () => {
      try {
        await deleteTransaction(txnId);
        toast.success("取引を削除しました");
      } catch (e) {
        setRemovedOrphans((prev) => {
          const next = new Set(prev);
          next.delete(txnId);
          return next;
        });
        toast.error(e instanceof Error ? e.message : String(e));
      }
    });
  }

  /* ----- Bulk actions (server truth + refresh) ----- */

  function runBulk(fn: () => Promise<unknown>) {
    startTransition(async () => {
      try {
        const result = (await fn()) as { importDeleted?: boolean } | undefined;
        if (result?.importDeleted) {
          router.push("/reconcile");
          return;
        }
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
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
            👨‍👩‍👧 「家族」明細・「妻の個人支出」は <b>{familyUser.name}</b> の個人支出として作成されます
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

        {/* Progress */}
        <div className="flex items-center gap-2 pt-1 text-sm">
          <span className="font-semibold">残り {remaining}件</span>
          <span className="text-muted-foreground">/ 全 {total}件</span>
          <span className="ml-auto text-xs text-muted-foreground">
            一致 {stats.confirmed} ・ 作成 {stats.created} ・ 無視 {stats.ignored}
          </span>
        </div>
        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full bg-primary transition-all"
            style={{ width: total > 0 ? `${((total - remaining) / total) * 100}%` : "0%" }}
          />
        </div>
      </header>

      {/* Sticky bulk bar */}
      {remaining > 0 && (
        <div className="sticky top-[env(safe-area-inset-top)] z-10 card !py-2 flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-secondary text-xs"
            disabled={pending || stats.suggested === 0}
            onClick={() => runBulk(() => bulkAcceptHighConfidence({ importId: importRow.id, minConfidence: 80 }))}
          >
            候補を一括承認 {stats.suggested > 0 && `(${stats.suggested})`}
          </button>
          <button
            type="button"
            className="btn-secondary text-xs"
            disabled={pending || stats.aliasFillable === 0}
            onClick={() => runBulk(() => bulkCreateFromSuggestions({ importId: importRow.id }))}
            title="過去の学習から、店名が一致する未照合行をまとめて作成します"
          >
            推測で埋める {stats.aliasFillable > 0 && `(${stats.aliasFillable})`}
          </button>
          {stats.fxSuggested > 0 && (
            <button
              type="button"
              className="btn-secondary text-xs"
              disabled={pending}
              onClick={() => runBulk(() => bulkAcceptFxMatches({ importId: importRow.id }))}
            >
              ✈️ FX一括確定 ({stats.fxSuggested})
            </button>
          )}
          {stats.familyUnmatched > 0 && familyDefaultUserId && (
            <button
              type="button"
              className="btn-secondary text-xs"
              disabled={pending}
              onClick={() => runBulk(() => bulkCreateFamilyCard({ importId: importRow.id, user_id: familyDefaultUserId }))}
            >
              家族カード分を登録 ({stats.familyUnmatched})
            </button>
          )}
          <button
            type="button"
            className="btn-ghost text-xs border border-border ml-auto"
            disabled={pending}
            onClick={() => runBulk(() => runMatcher(importRow.id))}
          >
            再マッチ
          </button>
        </div>
      )}

      {/* Completion */}
      {done && (
        <section className="card text-center space-y-3 py-6">
          <div className="text-2xl">🎉</div>
          <p className="font-semibold">この明細の処理が完了しました</p>
          <p className="text-sm text-muted-foreground">
            一致 {stats.confirmed} ・ 作成 {stats.created} ・ 無視 {stats.ignored}
          </p>
          <div className="flex flex-wrap justify-center gap-2 pt-1">
            <button type="button" className="btn-primary text-sm" onClick={() => setBalanceCheckOpen(true)}>
              残高を照合する
            </button>
            <button type="button" className="btn-secondary text-sm" onClick={() => router.push("/reconcile")}>
              一覧へ戻る
            </button>
          </div>
        </section>
      )}

      <BalanceCheckSheet
        open={balanceCheckOpen}
        onOpenChange={setBalanceCheckOpen}
        onDone={() => router.push("/reconcile")}
      />

      {/* Queue */}
      <section className="space-y-2">
        {queue.map((r) => (
          <StagingCard
            key={r.id}
            row={r}
            txn={r.matched_transaction_id ? txnById.get(r.matched_transaction_id) ?? null : null}
            groupMembers={r.match_group_id ? groupSiblings.get(r.match_group_id) ?? null : null}
            users={users}
            categories={categories}
            familyDefaultUserId={familyDefaultUserId}
            familyUserName={familyUser?.name ?? null}
            alias={aliasSuggestions[r.id] ?? null}
            aliasLabel={aliasSuggestions[r.id] ? describeAlias(aliasSuggestions[r.id], catById, userById) : null}
            isDuplicate={dupeSet.has(r.id)}
            pending={pending}
            onAccept={() => onAccept(r)}
            onReject={() => onReject(r)}
            onIgnore={() => onIgnore(r)}
            onCreate={(payload) => onCreate(r, payload)}
            onWife={
              familyDefaultUserId
                ? () => onCreate(r, { user_id: familyDefaultUserId, category_type: "personal", category_id: null })
                : null
            }
            onAlias={
              aliasSuggestions[r.id]?.user_id && aliasSuggestions[r.id]?.category_type
                ? () =>
                    onCreate(r, {
                      user_id: aliasSuggestions[r.id].user_id as string,
                      category_type: aliasSuggestions[r.id].category_type as TxnKind,
                      category_id: aliasSuggestions[r.id].category_id,
                    })
                : null
            }
          />
        ))}
      </section>

      {/* Processed (collapsed) */}
      {processed.length > 0 && (
        <details className="card">
          <summary className="cursor-pointer text-sm font-medium">
            処理済み {processed.length}件（一致・作成・無視）
          </summary>
          <ul className="divide-y divide-border mt-2">
            {processed.map((r) => (
              <li key={r.id} className="py-2 flex items-baseline gap-2 text-sm">
                <span className="text-xs text-muted-foreground tabular-nums shrink-0">{r.date}</span>
                <span className="font-mono tabular-nums shrink-0">¥{r.amount.toLocaleString()}</span>
                <span className="truncate flex-1 min-w-0">{r.merchant ?? "—"}</span>
                <StatusBadge status={r.status} confidence={r.match_confidence} />
                {(r.status === "confirmed" || r.status === "ignored" || r.status === "created") && (
                  <button
                    type="button"
                    className="text-xs underline text-muted-foreground shrink-0"
                    disabled={pending}
                    onClick={() => onReject(r)}
                  >
                    やり直す
                  </button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      {orphanTxns.length > 0 && (
        <section className="card">
          <h2 className="font-semibold mb-2">明細に無い家計簿の取引（余分の可能性）</h2>
          <p className="text-xs text-muted-foreground mb-2">
            この期間にこのカードで登録されているが、明細に対応行が無い取引です。二重入力の疑いがあれば削除できます。
          </p>
          <ul className="divide-y divide-border">
            {orphanTxns.map((t) => (
              <li key={t.id} className="py-2 flex items-baseline gap-2 text-sm">
                <span className="text-xs text-muted-foreground tabular-nums shrink-0">{t.date}</span>
                <span className="font-mono tabular-nums shrink-0">¥{t.amount.toLocaleString()}</span>
                <span className="truncate flex-1 min-w-0">{t.note ?? "—"}</span>
                <button
                  type="button"
                  className="text-xs text-destructive underline shrink-0"
                  disabled={pending}
                  onClick={() => onDeleteOrphan(t.id)}
                >
                  削除
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex justify-end pt-2">
        <button
          type="button"
          className="btn-ghost text-xs text-muted-foreground"
          disabled={pending}
          onClick={() => {
            if (!confirm("このインポートを削除しますか？\n承認済みの家計簿取引は残ります。")) return;
            startTransition(async () => {
              try {
                await archiveImport(importRow.id);
                router.push("/reconcile");
              } catch (e) {
                toast.error(e instanceof Error ? e.message : String(e));
              }
            });
          }}
        >
          このインポートを削除
        </button>
      </div>
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

function describeAlias(
  alias: AliasValue,
  catById: Map<string, CategoryRow>,
  userById: Map<string, UserRow>,
): string {
  const cat = alias.category_id ? catById.get(alias.category_id)?.name : null;
  const kind = alias.category_type ? TXN_KIND_LABEL[alias.category_type] : "";
  const who = alias.user_id ? userById.get(alias.user_id)?.name : null;
  return [who, cat ?? kind].filter(Boolean).join("・");
}

/* ---------------------------------------------------------------------- */

function StagingCard({
  row, txn, groupMembers, users, categories, familyDefaultUserId, familyUserName,
  alias, aliasLabel, isDuplicate, pending,
  onAccept, onReject, onIgnore, onCreate, onWife, onAlias,
}: {
  row: StagingRow;
  txn: TxnRow | null;
  groupMembers: StagingRow[] | null;
  users: UserRow[];
  categories: CategoryRow[];
  familyDefaultUserId: string | null;
  familyUserName: string | null;
  alias: AliasValue | null;
  aliasLabel: string | null;
  isDuplicate: boolean;
  pending: boolean;
  onAccept: () => void;
  onReject: () => void;
  onIgnore: () => void;
  onCreate: (p: { user_id: string; category_type: TxnKind; category_id: string | null; note?: string }) => void;
  onWife: (() => void) | null;
  onAlias: (() => void) | null;
}) {
  const [picking, setPicking] = useState(false);
  const isGroup = !!groupMembers && groupMembers.length >= 2;
  const groupSum = isGroup ? groupMembers!.reduce((s, m) => s + m.amount, 0) : 0;

  const isFamily = row.cardholder === "family";
  const defaultUserId = isFamily && familyDefaultUserId ? familyDefaultUserId : users[0]?.id ?? "";
  const defaultKind: TxnKind = isFamily ? "personal" : "variable";
  const merchantHasGarble = looksGarbled(row.merchant);

  return (
    <article className="card !p-3 space-y-2">
      <div className="flex items-baseline gap-2">
        <span className="text-xs text-muted-foreground tabular-nums shrink-0">{row.date}</span>
        <span className="font-mono tabular-nums shrink-0 font-semibold text-base">¥{row.amount.toLocaleString()}</span>
        {isFamily && <span className="chip bg-primary/15 text-primary text-[10px] shrink-0">家族</span>}
        {isDuplicate && (
          <span className="chip bg-amber-500/15 text-amber-700 text-[10px] shrink-0" title="同じ日付・金額の取引が既に登録されています">
            重複の可能性
          </span>
        )}
        <div className="ml-auto shrink-0">
          <StatusBadge status={row.status} confidence={row.match_confidence} />
        </div>
      </div>

      <div className="text-sm">
        <div className="break-all font-medium">{row.merchant || "—"}</div>
        {merchantHasGarble && (
          <div className="text-[11px] text-amber-700 bg-amber-500/10 border border-amber-500/30 rounded px-1.5 py-0.5 inline-block mt-1">
            ⚠ 文字化けの可能性あり。「カテゴリを選ぶ」で編集できます。
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

      {/* Suggested → big accept / reject */}
      {row.status === "suggested" ? (
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className="btn-primary text-sm h-11" disabled={pending} onClick={onAccept}>
            ✓ 採用{isGroup && ` (${groupMembers!.length})`}
          </button>
          <button type="button" className="btn-secondary text-sm h-11" disabled={pending} onClick={onReject}>
            ✗ 却下
          </button>
        </div>
      ) : (
        /* Unmatched → chip row */
        <div className="flex flex-wrap gap-1.5">
          {onAlias && aliasLabel && (
            <button type="button" className="chip border border-primary/40 bg-primary/10 text-primary text-xs h-9 px-3" disabled={pending} onClick={onAlias}>
              推測: {aliasLabel}
            </button>
          )}
          {onWife && (
            <button type="button" className="chip border border-border bg-card text-xs h-9 px-3" disabled={pending} onClick={onWife}>
              {familyUserName ? `${familyUserName}の個人支出` : "妻の個人支出"}
            </button>
          )}
          <button type="button" className="chip border border-border bg-card text-xs h-9 px-3" disabled={pending} onClick={() => setPicking((v) => !v)}>
            カテゴリを選ぶ ▾
          </button>
          <button
            type="button"
            className={`chip border text-xs h-9 px-3 ${isDuplicate ? "border-amber-500/40 bg-amber-500/10 text-amber-700" : "border-border bg-card"}`}
            disabled={pending}
            onClick={onIgnore}
          >
            無視
          </button>
        </div>
      )}

      {picking && row.status === "unmatched" && (
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
              setPicking(false);
            }}
            onCancel={() => setPicking(false)}
          />
        </div>
      )}
    </article>
  );
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
  const cats = categories.filter((c) => (kind === "personal" ? c.type === "personal" : c.type === "shared"));

  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ user_id: userId, category_type: kind, category_id: categoryId || null, note });
      }}
    >
      <label className="block text-xs space-y-1">
        <span className="text-muted-foreground">店名（メモとして残ります、文字化けはここで直してください）</span>
        <input className="input text-sm" value={note} onChange={(e) => setNote(e.target.value)} placeholder="店名・内容" />
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
        <button type="submit" className="btn-primary text-sm h-11" disabled={pending || !userId}>作成</button>
        <button type="button" className="btn-ghost text-sm h-11 border border-border" onClick={onCancel}>キャンセル</button>
      </div>
    </form>
  );
}

function StatusBadge({ status, confidence }: { status: StagingRow["status"]; confidence: number | null }) {
  const map: Record<StagingRow["status"], { label: string; tone: PillTone }> = {
    confirmed: { label: "✓ 一致", tone: "success" },
    suggested: { label: `? 候補 ${confidence ?? ""}`, tone: "warn" },
    unmatched: { label: "⚠ 未処理", tone: "danger" },
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
