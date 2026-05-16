"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type {
  CategoryRow,
  FixedCostMasterRow,
  UserRow,
  InvestmentAccountRow,
  PaymentMethodRow,
  CashBalanceSnapshotRow,
  KindColorRow,
  TripRow,
} from "@/lib/types";
import { yen, monthKey, todayIso } from "@/lib/format";
import { formatDayOfMonth } from "@/lib/paymentSchedule";
import {
  createUser,
  deleteUser,
  renameUser,
  updateUserColor,
  upsertCategory,
  upsertKindColor,
  deleteCategory,
  reorderCategories,
  upsertFixedCost,
  deleteFixedCost,
  upsertPaymentMethod,
  deletePaymentMethod,
  setPaymentMethodArchived,
  bulkAssignPaymentMethod,
  upsertCashBalance,
  deleteCashBalance,
  renameHousehold,
  updateHouseholdDefaults,
  inviteMember,
  switchHousehold,
  changeMemberRole,
  removeMember,
  revokeInvitation,
  listMembers,
  listInvitations,
  type MemberRow,
  type InvitationRow,
} from "../actions/settings";
import { createAccount, deleteAccount } from "../actions/investment";
import { TripSection } from "./components/TripSection";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { MoneyInput } from "@/components/ui/MoneyInput";
import { ColorPicker } from "@/components/ui/ColorPicker";
import { OnboardingTour } from "@/components/onboarding/OnboardingTour";
import {
  buildCategoryColorMap,
  KIND_DEFAULT_HEX,
  KIND_LABEL,
  KIND_ORDER,
  colorsFromHex,
} from "@/lib/categoryColors";
import { buildUserColorMap } from "@/lib/userColors";
import type { ColorKindKey } from "@/lib/types";
import type { HouseholdMembership } from "@/lib/auth";

export default function SettingsClient({
  users,
  categories,
  fixed,
  investmentAccounts,
  paymentMethods,
  cashSnapshots,
  kindColors,
  trips,
  household,
  memberships,
}: {
  users: UserRow[];
  categories: CategoryRow[];
  fixed: FixedCostMasterRow[];
  investmentAccounts: InvestmentAccountRow[];
  paymentMethods: PaymentMethodRow[];
  cashSnapshots: CashBalanceSnapshotRow[];
  kindColors: KindColorRow[];
  trips: TripRow[];
  household: HouseholdMembership;
  memberships: HouseholdMembership[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Effective color maps so list rows always show the *current* color users
  // see in the rest of the app (custom hex if set, position-based fallback if
  // not). Computed once per render.
  const userColorMap = buildUserColorMap(users);
  const categoryColorMap = buildCategoryColorMap(categories);
  const validTabs = [
    "household",
    "users",
    "categories",
    "fixed",
    "payments",
    "cash",
    "accounts",
    "trips",
    "data",
  ] as const;
  const initialTab = (() => {
    const t = searchParams?.get("tab") ?? "";
    return (validTabs as readonly string[]).includes(t) ? t : "household";
  })();
  const [tab, setTab] = useState(initialTab);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function changeTab(next: string) {
    setTab(next);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", next);
      window.history.replaceState({}, "", url.toString());
    }
  }

  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    router.replace("/login");
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">設定</h1>
        <button onClick={logout} className="btn-ghost text-sm">ログアウト</button>
      </div>

      {err && <p className="text-sm text-destructive">{err}</p>}

      <Tabs value={tab} onValueChange={changeTab} className="w-full">
        <TabsList className="w-full grid grid-cols-3 sm:grid-cols-9 h-auto">
          <TabsTrigger value="household">世帯</TabsTrigger>
          <TabsTrigger value="users">メンバー</TabsTrigger>
          <TabsTrigger value="categories">カテゴリ・色</TabsTrigger>
          <TabsTrigger value="fixed">固定費</TabsTrigger>
          <TabsTrigger value="payments">支払方法</TabsTrigger>
          <TabsTrigger value="cash">現金残高</TabsTrigger>
          <TabsTrigger value="accounts">証券口座</TabsTrigger>
          <TabsTrigger value="trips">旅行</TabsTrigger>
          <TabsTrigger value="data">データ管理</TabsTrigger>
        </TabsList>

        <TabsContent value="household">
          <HouseholdSettings
            household={household}
            memberships={memberships}
            users={users}
            paymentMethods={paymentMethods}
            start={start}
            onError={setErr}
            pending={pending}
          />
        </TabsContent>

        <TabsContent value="users">
          <section className="card">
            <h2 className="font-semibold mb-3">ユーザー</h2>
            <ul className="divide-y divide-border">
              {users.map((u) => (
                <UserRowItem
                  key={u.id}
                  user={u}
                  effectiveColor={userColorMap.get(u.id)?.chart ?? "#64748b"}
                  start={start}
                  onError={setErr}
                  pending={pending}
                />
              ))}
            </ul>
            <AddUserForm start={start} onError={setErr} pending={pending} />
          </section>
        </TabsContent>

        <TabsContent value="categories" className="space-y-4">
          <section className="card">
            <h2 className="font-semibold mb-1">変動費カテゴリ</h2>
            <p className="text-xs text-muted-foreground mb-3">
              月ごとの予算と色を設定できます。色は取引一覧やチャートに反映されます。
            </p>
            <CategoryList
              categories={categories}
              colorMap={categoryColorMap}
              start={start}
              onError={setErr}
              pending={pending}
            />
            <AddCategoryForm start={start} onError={setErr} pending={pending} />
          </section>
          <KindColorSettings rows={kindColors} start={start} onError={setErr} pending={pending} />
        </TabsContent>

        <TabsContent value="fixed">
          <section className="card">
            <h2 className="font-semibold mb-3">固定費マスタ</h2>
            <FixedCostList
              users={users}
              fixed={fixed}
              paymentMethods={paymentMethods}
              start={start}
              onError={setErr}
              pending={pending}
            />
            <AddFixedCostForm
              users={users}
              paymentMethods={paymentMethods}
              start={start}
              onError={setErr}
              pending={pending}
            />
          </section>
        </TabsContent>

        <TabsContent value="cash">
          <section className="card">
            <h2 className="font-semibold mb-1">現金残高</h2>
            <p className="text-xs text-muted-foreground mb-3">
              「現在いくら現金（銀行・財布合算）があるか」を記録します。最新の手入力スナップショットを起点に、その後の収入・支出・カード引落を加減算してリアルタイム残高を計算します。残高がずれた時は新しいスナップショットを追加して再アンカーしてください。
            </p>
            <CashBalanceList snapshots={cashSnapshots} start={start} onError={setErr} pending={pending} />
            <AddCashBalanceForm start={start} onError={setErr} pending={pending} />
          </section>
        </TabsContent>

        <TabsContent value="payments">
          <section className="card">
            <h2 className="font-semibold mb-1">支払方法</h2>
            <p className="text-xs text-muted-foreground mb-3">
              現金・振込・クレジットカードを登録します。クレカは締め日と支払日を入れると、月次CFをカード請求月ベースで集計できるようになります。
            </p>
            <PaymentMethodList
              users={users}
              methods={paymentMethods}
              start={start}
              onError={setErr}
              pending={pending}
            />
            <AddPaymentMethodForm
              users={users}
              start={start}
              onError={setErr}
              pending={pending}
            />
            <BulkPaymentMethodAssign
              users={users}
              methods={paymentMethods}
              start={start}
              onError={setErr}
              pending={pending}
            />
          </section>
        </TabsContent>

        <TabsContent value="accounts">
          <section className="card">
            <h2 className="font-semibold mb-3">証券口座</h2>
            <ul className="divide-y divide-border">
              {investmentAccounts.map((a) => (
                <li key={a.id} className="py-2 flex items-center gap-2 min-w-0">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{a.account_name}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {a.provider} · {users.find((u) => u.id === a.user_id)?.name ?? "共同"}
                    </div>
                  </div>
                  <span className={`chip text-xs shrink-0 ${a.is_active ? "bg-success/15 text-success" : "bg-muted"}`}>
                    {a.is_active ? "有効" : "無効"}
                  </span>
                  <button
                    className="btn-danger text-xs py-1 px-2 shrink-0"
                    disabled={pending}
                    onClick={() => {
                      if (!confirm(`${a.account_name} を削除しますか？関連する保有銘柄も削除されます。`)) return;
                      start(async () => {
                        try { await deleteAccount(a.id); } catch (e: any) { setErr(e.message); }
                      });
                    }}
                  >削除</button>
                </li>
              ))}
              {investmentAccounts.length === 0 && (
                <li className="py-2 text-muted-foreground text-sm">証券口座が登録されていません。</li>
              )}
            </ul>
            <AddAccountForm users={users} start={start} onError={setErr} pending={pending} />
          </section>
        </TabsContent>

        <TabsContent value="trips">
          <TripSection trips={trips} />
        </TabsContent>

        <TabsContent value="data">
          <DataManagement role={household.role} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* -------------------- Kind colors (income / fixed / special / etc.) -------------------- */
function KindColorSettings({
  rows, start, onError, pending,
}: {
  rows: KindColorRow[];
  start: (fn: () => void) => void;
  onError: (e: string | null) => void;
  pending: boolean;
}) {
  const [draft, setDraft] = useState<Record<ColorKindKey, string>>(() => {
    const out = {} as Record<ColorKindKey, string>;
    for (const k of KIND_ORDER) {
      const found = rows.find((r) => r.kind === k);
      out[k] = found?.color_hex ?? KIND_DEFAULT_HEX[k];
    }
    return out;
  });

  return (
    <section className="card">
      <h2 className="font-semibold mb-1">種類別カラー</h2>
      <p className="text-xs text-muted-foreground mb-3">
        カテゴリ以外の取引種類（収入・固定費・特別費・立替など）の色を設定します。設定した色は取引一覧やチャートで使われます。
      </p>
      <ul className="divide-y divide-border">
        {KIND_ORDER.map((kind) => {
          const current = draft[kind];
          const colors = colorsFromHex(current);
          return (
            <li key={kind} className="py-3 space-y-2">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  aria-hidden="true"
                  className="h-4 w-4 rounded-full shrink-0 border border-border"
                  style={{ backgroundColor: colors.chart }}
                />
                <div className="flex-1 font-medium truncate">{KIND_LABEL[kind]}</div>
                <span
                  className="chip border text-[11px] py-0 px-2 shrink-0"
                  style={{
                    backgroundColor: colors.bg,
                    color: colors.text,
                    borderColor: colors.chart,
                  }}
                >
                  プレビュー
                </span>
              </div>
              <ColorPicker
                ariaLabel={`${KIND_LABEL[kind]}の色`}
                value={current}
                onChange={(hex) => {
                  const next = hex ?? KIND_DEFAULT_HEX[kind];
                  setDraft((prev) => ({ ...prev, [kind]: next }));
                  start(async () => {
                    onError(null);
                    try {
                      await upsertKindColor({ kind, color_hex: next });
                    } catch (e: any) {
                      onError(e.message);
                    }
                  });
                }}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* -------------------- Data management (DSAR) -------------------- */
function DataManagement({ role }: { role: "owner" | "editor" | "viewer" }) {
  const [confirming, setConfirming] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onDelete() {
    if (confirmText !== "DELETE") {
      setError('"DELETE" と入力してください。');
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch("/api/me/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "DELETE" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "削除に失敗しました。");
      window.location.href = "/login";
    } catch (e: unknown) {
      setDeleting(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="space-y-4">
      <section className="card space-y-3">
        <h2 className="font-semibold">クレカ明細の突合</h2>
        <p className="text-sm text-muted-foreground">
          月次のカード明細 CSV をアップロードして、家計簿との差分を確認・補正できます。AMEX 形式と汎用パーサに対応。
        </p>
        <a href="/reconcile" className="btn-secondary text-sm inline-block w-full sm:w-auto text-center">
          明細インポートを開く
        </a>
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold">データのエクスポート</h2>
        <p className="text-sm text-muted-foreground">
          あなたが所属する世帯の全データを ZIP（JSON + CSV）でダウンロードできます。バックアップや、本サービスを離れる際のデータ持ち出しに利用してください。
        </p>
        <a href="/api/me/export" className="btn-primary text-sm inline-block w-full sm:w-auto text-center">
          ZIP をダウンロード
        </a>
      </section>

      <section className="card space-y-3 border-destructive/30">
        <h2 className="font-semibold text-destructive">アカウント削除</h2>
        <p className="text-sm text-muted-foreground">
          アカウントを削除すると、ログイン情報が抹消されます。
          {role === "owner"
            ? " あなたが世帯の唯一のオーナーである場合、世帯と全データ（取引・カテゴリ・固定費・投資・現金残高）も同時に削除されます。"
            : " 世帯のデータは他のメンバーが利用継続します。あなたのメンバー権限のみ削除されます。"}
          {" "}この操作は元に戻せません。
        </p>

        {!confirming ? (
          <button
            onClick={() => setConfirming(true)}
            className="btn-danger text-sm w-full sm:w-auto"
          >
            削除を開始する
          </button>
        ) : (
          <div className="space-y-2">
            <label className="block space-y-1">
              <span className="text-sm">
                確認のため <code className="font-mono bg-muted px-1 py-0.5 rounded">DELETE</code> と入力してください
              </span>
              <input
                className="input"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="DELETE"
                autoFocus
              />
            </label>
            {error && (
              <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}
            <div className="flex gap-2">
              <button
                onClick={onDelete}
                disabled={deleting || confirmText !== "DELETE"}
                className="btn-danger text-sm flex-1"
              >
                {deleting ? "削除中..." : "アカウントを完全に削除"}
              </button>
              <button
                onClick={() => { setConfirming(false); setConfirmText(""); setError(null); }}
                disabled={deleting}
                className="btn-ghost text-sm"
              >
                キャンセル
              </button>
            </div>
          </div>
        )}
      </section>

      <p className="text-xs text-muted-foreground text-center">
        詳しくは{" "}
        <a href="/legal/privacy" className="text-primary underline">プライバシーポリシー</a>
        {" "}/{" "}
        <a href="/legal/terms" className="text-primary underline">利用規約</a>
      </p>
    </div>
  );
}

/* -------------------- Users -------------------- */
function UserRowItem({
  user, effectiveColor, start, onError, pending,
}: {
  user: UserRow;
  /** Effective hex color: user.color_hex if set, else position-based fallback. */
  effectiveColor: string;
  start: (fn: () => void) => void;
  onError: (e: string | null) => void;
  pending: boolean;
}) {
  const [name, setName] = useState(user.name);
  const [editing, setEditing] = useState(false);
  const [colorHex, setColorHex] = useState<string | null>(user.color_hex);

  if (editing) {
    return (
      <li className="py-2 space-y-2">
        <div className="flex items-center gap-2 min-w-0">
          <input className="input flex-1 min-w-0" value={name} onChange={(e) => setName(e.target.value)} />
          <button
            className="btn-primary text-xs py-1 px-3 shrink-0"
            disabled={pending}
            onClick={() => start(async () => {
              onError(null);
              try {
                if (name !== user.name) await renameUser(user.id, name);
                if (colorHex !== user.color_hex) await updateUserColor(user.id, colorHex);
                setEditing(false);
              } catch (e: any) { onError(e.message); }
            })}
          >保存</button>
          <button
            className="btn-ghost text-xs py-1 px-3 shrink-0"
            onClick={() => { setName(user.name); setColorHex(user.color_hex); setEditing(false); }}
          >キャンセル</button>
        </div>
        <ColorPicker label="色" value={colorHex} onChange={setColorHex} />
      </li>
    );
  }

  return (
    <li className="py-2 flex items-center gap-2 min-w-0">
      <span
        aria-hidden="true"
        className="h-3 w-3 rounded-full shrink-0 border border-border"
        style={{ backgroundColor: effectiveColor }}
        title={user.color_hex ? "カスタム色" : "デフォルト色"}
      />
      <div className="flex-1 truncate font-medium">{user.name}</div>
      <button className="btn-ghost text-xs py-1 px-2 shrink-0" onClick={() => setEditing(true)}>編集</button>
      <button
        className="btn-danger text-xs py-1 px-2 shrink-0"
        disabled={pending}
        onClick={() => {
          if (!confirm(`${user.name} を削除しますか？`)) return;
          start(async () => {
            onError(null);
            try { await deleteUser(user.id); } catch (e: any) { onError(e.message); }
          });
        }}
      >削除</button>
    </li>
  );
}

function AddUserForm({
  start, onError, pending,
}: { start: (fn: () => void) => void; onError: (e: string | null) => void; pending: boolean }) {
  const [name, setName] = useState("");
  return (
    <form
      className="mt-3 flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          onError(null);
          try { await createUser(name); setName(""); } catch (err: any) { onError(err.message); }
        });
      }}
    >
      <input className="input flex-1" placeholder="新しいユーザー名" value={name} onChange={(e) => setName(e.target.value)} />
      <button className="btn-primary" disabled={pending}>追加</button>
    </form>
  );
}

/* -------------------- Categories -------------------- */
function CategoryList({
  categories, colorMap, start, onError, pending,
}: {
  categories: CategoryRow[];
  colorMap: Map<string, { chart: string; bg: string; text: string }>;
  start: (fn: () => void) => void;
  onError: (e: string | null) => void;
  pending: boolean;
}) {
  return (
    <ul className="divide-y divide-border">
      {categories.map((c, idx) => (
        <CategoryRowItem
          key={c.id}
          c={c}
          effectiveColor={colorMap.get(c.id)?.chart ?? "#64748b"}
          canUp={idx > 0}
          canDown={idx < categories.length - 1}
          onMove={(dir) => {
            const ids = categories.map((x) => x.id);
            const i = ids.indexOf(c.id);
            const j = i + dir;
            if (j < 0 || j >= ids.length) return;
            [ids[i], ids[j]] = [ids[j], ids[i]];
            start(async () => {
              try { await reorderCategories(ids); } catch (e: any) { onError(e.message); }
            });
          }}
          start={start}
          onError={onError}
          pending={pending}
        />
      ))}
    </ul>
  );
}

function CategoryRowItem({
  c, effectiveColor, canUp, canDown, onMove, start, onError, pending,
}: {
  c: CategoryRow;
  /** Effective hex color: c.color_hex if set, else palette fallback. */
  effectiveColor: string;
  canUp: boolean;
  canDown: boolean;
  onMove: (dir: -1 | 1) => void;
  start: (fn: () => void) => void;
  onError: (e: string | null) => void;
  pending: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(c.name);
  const [budget, setBudget] = useState(String(c.budget_amount));
  const [colorHex, setColorHex] = useState<string | null>(c.color_hex);

  if (editing) {
    return (
      <li className="py-2 space-y-2">
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <input className="input flex-1 min-w-0" value={name} onChange={(e) => setName(e.target.value)} placeholder="カテゴリ名" />
          <MoneyInput className="input sm:w-32" value={budget} onChange={setBudget} placeholder="予算" />
          <div className="flex gap-2 justify-end shrink-0">
            <button
              className="btn-primary text-xs py-1 px-3"
              disabled={pending}
              onClick={() => start(async () => {
                onError(null);
                try {
                  await upsertCategory({
                    id: c.id, name, type: c.type,
                    budget_amount: parseInt(budget, 10) || 0,
                    sort_order: c.sort_order, is_active: c.is_active,
                    color_hex: colorHex,
                  });
                  setEditing(false);
                } catch (e: any) { onError(e.message); }
              })}
            >保存</button>
            <button className="btn-ghost text-xs py-1 px-3" onClick={() => setEditing(false)}>キャンセル</button>
          </div>
        </div>
        <ColorPicker label="色" value={colorHex} onChange={setColorHex} />
      </li>
    );
  }

  return (
    <li className="py-2 flex flex-col sm:flex-row sm:items-center gap-2">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <span className="chip bg-muted text-xs w-12 justify-center shrink-0">{c.type === "shared" ? "共同" : "個人"}</span>
        <span
          aria-hidden="true"
          className="h-3 w-3 rounded-full shrink-0 border border-border"
          style={{ backgroundColor: effectiveColor }}
          title={c.color_hex ? "カスタム色" : "デフォルト色"}
        />
        <div className="font-medium truncate min-w-0 flex-1">{c.name}</div>
        <div className="text-sm text-muted-foreground tabular-nums shrink-0">{yen(c.budget_amount)}</div>
      </div>
      <div className="flex items-center gap-1 justify-end shrink-0">
        <button disabled={!canUp} className="btn-ghost text-xs py-1 px-2 disabled:opacity-30" onClick={() => onMove(-1)} aria-label="上へ">↑</button>
        <button disabled={!canDown} className="btn-ghost text-xs py-1 px-2 disabled:opacity-30" onClick={() => onMove(1)} aria-label="下へ">↓</button>
        <button className="btn-ghost text-xs py-1 px-2" onClick={() => setEditing(true)}>編集</button>
        <button
          className="btn-danger text-xs py-1 px-2"
          disabled={pending}
          onClick={() => {
            if (!confirm(`${c.name} を削除しますか？（取引記録のカテゴリは空になります）`)) return;
            start(async () => { try { await deleteCategory(c.id); } catch (e: any) { onError(e.message); } });
          }}
        >削除</button>
      </div>
    </li>
  );
}

function AddCategoryForm({
  start, onError, pending,
}: { start: (fn: () => void) => void; onError: (e: string | null) => void; pending: boolean }) {
  const [name, setName] = useState("");
  const [type, setType] = useState<"shared" | "personal">("shared");
  const [budget, setBudget] = useState("0");
  return (
    <form
      className="mt-3 grid grid-cols-1 sm:grid-cols-4 gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          onError(null);
          try {
            await upsertCategory({
              name, type,
              budget_amount: parseInt(budget, 10) || 0,
              sort_order: 999, is_active: true,
            });
            setName(""); setBudget("0");
          } catch (err: any) { onError(err.message); }
        });
      }}
    >
      <input className="input" placeholder="新しいカテゴリ名" value={name} onChange={(e) => setName(e.target.value)} />
      <select className="input" value={type} onChange={(e) => setType(e.target.value as any)}>
        <option value="shared">共同</option>
        <option value="personal">個人</option>
      </select>
      <MoneyInput className="input" placeholder="月次予算" value={budget} onChange={setBudget} />
      <button className="btn-primary" disabled={pending}>追加</button>
    </form>
  );
}

/* -------------------- Fixed cost masters -------------------- */
function FixedCostList({
  users, fixed, paymentMethods, start, onError, pending,
}: {
  users: UserRow[];
  fixed: FixedCostMasterRow[];
  paymentMethods: PaymentMethodRow[];
  start: (fn: () => void) => void;
  onError: (e: string | null) => void;
  pending: boolean;
}) {
  return (
    <ul className="divide-y divide-border">
      {fixed.map((f) => (
        <FixedCostItem
          key={f.id}
          f={f}
          users={users}
          paymentMethods={paymentMethods}
          start={start}
          onError={onError}
          pending={pending}
        />
      ))}
      {fixed.length === 0 && <li className="py-2 text-muted-foreground text-sm">未登録</li>}
    </ul>
  );
}

function FixedCostItem({
  f, users, paymentMethods, start, onError, pending,
}: {
  f: FixedCostMasterRow;
  users: UserRow[];
  paymentMethods: PaymentMethodRow[];
  start: (fn: () => void) => void;
  onError: (e: string | null) => void;
  pending: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(f.label);
  const [name, setName] = useState(f.name);
  const [userId, setUserId] = useState(f.user_id ?? "");
  const [amount, setAmount] = useState(String(f.amount));
  const [validFromMonth, setValidFromMonth] = useState(f.valid_from.slice(0, 7));
  const [paymentMethodId, setPaymentMethodId] = useState(f.payment_method_id ?? "");
  const [paymentDay, setPaymentDay] = useState(f.payment_day != null ? String(f.payment_day) : "");
  const [notes, setNotes] = useState(f.notes ?? "");

  const pmName = paymentMethods.find((m) => m.id === f.payment_method_id)?.name;

  if (!editing) {
    return (
      <li className="py-2 flex items-center gap-2 text-sm min-w-0">
        <span className="chip bg-muted text-xs shrink-0">{f.label}</span>
        <div className="flex-1 min-w-0">
          <div className="font-medium truncate">{f.name}</div>
          <div className="text-xs text-muted-foreground truncate">
            {users.find((u) => u.id === f.user_id)?.name ?? "共同"} · 開始 {f.valid_from.slice(0, 7)}
            {f.payment_day != null && ` · 毎月${f.payment_day}日`}
            {pmName && ` · ${pmName}`}
          </div>
        </div>
        <div className="text-right tabular-nums shrink-0 font-medium">{yen(f.amount)}</div>
        <button
          className="btn-ghost text-xs py-1 px-2 shrink-0"
          onClick={() => setEditing(true)}
        >編集</button>
        <button
          className="btn-danger text-xs py-1 px-2 shrink-0"
          disabled={pending}
          onClick={() => {
            if (!confirm("削除しますか？（既に適用済の過去月取引には影響しません）")) return;
            start(async () => { try { await deleteFixedCost(f.id); } catch (e: unknown) { onError(e instanceof Error ? e.message : String(e)); } });
          }}
        >削除</button>
      </li>
    );
  }

  return (
    <li className="py-3 space-y-2">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <select className="input" value={label} onChange={(e) => setLabel(e.target.value)}>
          <option value="固定費">固定費</option>
          <option value="ローン">ローン</option>
          {users.map((u) => (
            <option key={u.id} value={`${u.name}固定費`}>{`${u.name}固定費`}</option>
          ))}
        </select>
        <input className="input" placeholder="名称" value={name} onChange={(e) => setName(e.target.value)} />
        <select className="input" value={userId} onChange={(e) => setUserId(e.target.value)}>
          <option value="">共同</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <MoneyInput className="input" placeholder="金額" value={amount} onChange={setAmount} />
        <input className="input" type="month" value={validFromMonth} onChange={(e) => setValidFromMonth(e.target.value)} />
        <select className="input" value={paymentMethodId} onChange={(e) => setPaymentMethodId(e.target.value)}>
          <option value="">支払方法 未設定</option>
          {paymentMethods
            .filter((m) => !m.archived)
            .map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}（{m.user_id ? users.find((u) => u.id === m.user_id)?.name ?? "?" : "共同"}）
              </option>
            ))}
        </select>
        <input
          className="input"
          type="number"
          min={1}
          max={31}
          placeholder="支払日 (1-31)"
          value={paymentDay}
          onChange={(e) => setPaymentDay(e.target.value)}
        />
      </div>
      <input className="input" placeholder="メモ（任意）" value={notes} onChange={(e) => setNotes(e.target.value)} />
      <div className="flex gap-2">
        <button
          className="btn-primary text-sm flex-1"
          disabled={pending}
          onClick={() => start(async () => {
            onError(null);
            try {
              await upsertFixedCost({
                id: f.id,
                label,
                name,
                user_id: userId || null,
                amount: parseInt(amount, 10) || 0,
                valid_from_month: validFromMonth,
                notes: notes || null,
                payment_method_id: paymentMethodId || null,
                payment_day: paymentDay ? parseInt(paymentDay, 10) : null,
              });
              setEditing(false);
            } catch (e: unknown) { onError(e instanceof Error ? e.message : String(e)); }
          })}
        >保存</button>
        <button className="btn-ghost text-sm" onClick={() => setEditing(false)}>キャンセル</button>
      </div>
    </li>
  );
}

function AddFixedCostForm({
  users, paymentMethods, start, onError, pending,
}: {
  users: UserRow[];
  paymentMethods: PaymentMethodRow[];
  start: (fn: () => void) => void;
  onError: (e: string | null) => void;
  pending: boolean;
}) {
  const [form, setForm] = useState({
    label: "固定費",
    name: "",
    user_id: "" as string,
    amount: "",
    valid_from_month: monthKey(),
    notes: "",
    payment_method_id: "" as string,
    payment_day: "" as string,
  });
  return (
    <form
      className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          onError(null);
          try {
            await upsertFixedCost({
              label: form.label,
              name: form.name,
              user_id: form.user_id || null,
              amount: parseInt(form.amount, 10) || 0,
              valid_from_month: form.valid_from_month,
              notes: form.notes || null,
              payment_method_id: form.payment_method_id || null,
              payment_day: form.payment_day ? parseInt(form.payment_day, 10) : null,
            });
            setForm({ ...form, name: "", amount: "", notes: "" });
          } catch (err: unknown) { onError(err instanceof Error ? err.message : String(err)); }
        });
      }}
    >
      <select className="input" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })}>
        <option value="固定費">固定費</option>
        <option value="ローン">ローン</option>
        {users.map((u) => (
          <option key={u.id} value={`${u.name}固定費`}>{`${u.name}固定費`}</option>
        ))}
      </select>
      <input className="input" placeholder="名称" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      <select className="input" value={form.user_id} onChange={(e) => setForm({ ...form, user_id: e.target.value })}>
        <option value="">共同</option>
        {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
      </select>
      <MoneyInput className="input" placeholder="金額" value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} />
      <input className="input" type="month" value={form.valid_from_month} onChange={(e) => setForm({ ...form, valid_from_month: e.target.value })} />
      <select
        className="input"
        value={form.payment_method_id}
        onChange={(e) => setForm({ ...form, payment_method_id: e.target.value })}
      >
        <option value="">支払方法 未設定</option>
        {paymentMethods
          .filter((m) => !m.archived)
          .map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}（{m.user_id ? users.find((u) => u.id === m.user_id)?.name ?? "?" : "共同"}）
            </option>
          ))}
      </select>
      <input
        className="input"
        type="number"
        min={1}
        max={31}
        placeholder="支払日 (1-31)"
        value={form.payment_day}
        onChange={(e) => setForm({ ...form, payment_day: e.target.value })}
      />
      <button className="btn-primary col-span-2 sm:col-span-3" disabled={pending}>追加</button>
    </form>
  );
}

/* -------------------- Cash balance -------------------- */
function CashBalanceList({
  snapshots, start, onError, pending,
}: {
  snapshots: CashBalanceSnapshotRow[];
  start: (fn: () => void) => void;
  onError: (e: string | null) => void;
  pending: boolean;
}) {
  if (snapshots.length === 0) {
    return <p className="text-sm text-muted-foreground">未登録です。下のフォームから現在の残高を入力してください。</p>;
  }
  return (
    <ul className="divide-y divide-border">
      {snapshots.map((s, i) => (
        <li key={s.id} className="py-2 flex items-center gap-2 text-sm">
          {i === 0 && <span className="chip bg-success/15 text-success text-[10px] shrink-0">最新</span>}
          <div className="flex-1 min-w-0">
            <div className="font-medium tabular-nums">{yen(s.balance)}</div>
            <div className="text-xs text-muted-foreground truncate">
              {s.as_of_date} 時点{s.note ? ` · ${s.note}` : ""}
            </div>
          </div>
          <button
            className="btn-danger text-xs py-1 px-2 shrink-0"
            disabled={pending}
            onClick={() => {
              if (!confirm("このスナップショットを削除しますか？")) return;
              start(async () => {
                try { await deleteCashBalance(s.id); }
                catch (e: unknown) { onError(e instanceof Error ? e.message : String(e)); }
              });
            }}
          >削除</button>
        </li>
      ))}
    </ul>
  );
}

function AddCashBalanceForm({
  start, onError, pending,
}: {
  start: (fn: () => void) => void;
  onError: (e: string | null) => void;
  pending: boolean;
}) {
  const [date, setDate] = useState(todayIso());
  const [balance, setBalance] = useState("");
  const [note, setNote] = useState("");
  return (
    <form
      className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const amt = parseInt(balance.replace(/,/g, ""), 10);
        if (!Number.isFinite(amt)) { onError("残高を入力してください。"); return; }
        start(async () => {
          onError(null);
          try {
            await upsertCashBalance({ as_of_date: date, balance: amt, note: note || null });
            setBalance("");
            setNote("");
          } catch (e: unknown) { onError(e instanceof Error ? e.message : String(e)); }
        });
      }}
    >
      <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      <MoneyInput className="input" placeholder="残高（円）" value={balance} onChange={setBalance} />
      <input className="input" placeholder="メモ（任意）" value={note} onChange={(e) => setNote(e.target.value)} />
      <button className="btn-primary" disabled={pending}>残高を記録</button>
    </form>
  );
}

/* -------------------- Investment Accounts -------------------- */
function AddAccountForm({
  users, start, onError, pending,
}: {
  users: UserRow[];
  start: (fn: () => void) => void;
  onError: (e: string | null) => void;
  pending: boolean;
}) {
  const [userId, setUserId] = useState(users[0]?.id ?? "");
  const [provider, setProvider] = useState("manual");
  const [name, setName] = useState("");
  return (
    <form
      className="mt-3 grid grid-cols-1 sm:grid-cols-4 gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        onError(null);
        if (!userId || !name) { onError("全ての項目を入力してください。"); return; }
        start(async () => {
          try {
            await createAccount({ user_id: userId, provider, account_name: name });
            setName("");
          } catch (err: any) { onError(err.message); }
        });
      }}
    >
      <select className="input" value={userId} onChange={(e) => setUserId(e.target.value)}>
        {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
      </select>
      <select className="input" value={provider} onChange={(e) => setProvider(e.target.value)}>
        <option value="manual">手動</option>
        <option value="rakuten">楽天証券</option>
        <option value="sbi">SBI証券</option>
      </select>
      <input className="input" placeholder="口座名" value={name} onChange={(e) => setName(e.target.value)} />
      <button className="btn-primary" disabled={pending}>口座追加</button>
    </form>
  );
}

/* -------------------- Payment methods -------------------- */
const PM_TYPE_LABEL: Record<PaymentMethodRow["type"], string> = {
  cash: "現金",
  transfer: "振込",
  credit_card: "クレジットカード",
};

function PaymentMethodList({
  users,
  methods,
  start,
  onError,
  pending,
}: {
  users: UserRow[];
  methods: PaymentMethodRow[];
  start: (fn: () => void) => void;
  onError: (e: string | null) => void;
  pending: boolean;
}) {
  if (methods.length === 0) {
    return (
      <p className="py-2 text-sm text-muted-foreground">
        まだ登録されていません。下のフォームから追加してください。
      </p>
    );
  }
  return (
    <ul className="divide-y divide-border">
      {methods.map((m) => (
        <PaymentMethodItem
          key={m.id}
          users={users}
          method={m}
          start={start}
          onError={onError}
          pending={pending}
        />
      ))}
    </ul>
  );
}

function PaymentMethodItem({
  users,
  method,
  start,
  onError,
  pending,
}: {
  users: UserRow[];
  method: PaymentMethodRow;
  start: (fn: () => void) => void;
  onError: (e: string | null) => void;
  pending: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(method.name);
  const [closingDay, setClosingDay] = useState<string>(method.closing_day?.toString() ?? "");
  const [paymentDay, setPaymentDay] = useState<string>(method.payment_day?.toString() ?? "");
  const [offset, setOffset] = useState<string>(method.payment_month_offset.toString());
  const [bank, setBank] = useState<string>(method.bank_account_label ?? "");
  const [userId, setUserId] = useState<string>(method.user_id ?? "");

  const ownerName = method.user_id
    ? users.find((u) => u.id === method.user_id)?.name ?? "(不明)"
    : "共同";

  if (!editing) {
    return (
      <li className={`py-2 flex items-center gap-2 min-w-0 ${method.archived ? "opacity-60" : ""}`}>
        <div className="flex-1 min-w-0">
          <div className="font-medium truncate flex items-center gap-2">
            {method.name}
            {method.archived && (
              <span className="chip bg-muted text-[10px] shrink-0">非表示</span>
            )}
          </div>
          <div className="text-xs text-muted-foreground truncate">
            {PM_TYPE_LABEL[method.type]} · {ownerName}
            {method.type === "credit_card" && (
              <>
                {" · 締め日 "}
                {formatDayOfMonth(method.closing_day)}
                {" / 支払日 "}
                {formatDayOfMonth(method.payment_day)}
                {method.payment_month_offset !== 1 && ` (${method.payment_month_offset}ヶ月後)`}
              </>
            )}
            {method.bank_account_label && ` · ${method.bank_account_label}`}
          </div>
        </div>
        <button
          className="btn-ghost text-xs py-1 px-2 shrink-0"
          disabled={pending}
          onClick={() => start(async () => {
            try { await setPaymentMethodArchived(method.id, !method.archived); }
            catch (e: unknown) { onError(e instanceof Error ? e.message : String(e)); }
          })}
          title={method.archived ? "ダッシュボードに表示する" : "ダッシュボードから非表示にする"}
        >
          {method.archived ? "表示する" : "非表示"}
        </button>
        <button
          className="btn-ghost text-xs py-1 px-2 shrink-0"
          onClick={() => setEditing(true)}
        >
          編集
        </button>
        <button
          className="btn-danger text-xs py-1 px-2 shrink-0"
          disabled={pending}
          onClick={() => {
            if (!confirm(`${method.name} を削除しますか？\n（取引で使用済みの場合はアーカイブされます）`)) return;
            start(async () => {
              try {
                await deletePaymentMethod(method.id);
              } catch (e: unknown) {
                onError(e instanceof Error ? e.message : String(e));
              }
            });
          }}
        >
          削除
        </button>
      </li>
    );
  }

  return (
    <li className="py-2 space-y-2">
      <input
        className="input"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="名称"
      />
      <select
        className="input"
        value={userId}
        onChange={(e) => setUserId(e.target.value)}
      >
        <option value="">共同</option>
        {users.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name}
          </option>
        ))}
      </select>
      {method.type === "credit_card" && (
        <div className="grid grid-cols-3 gap-2">
          <label className="text-xs text-muted-foreground">
            締め日
            <input
              className="input mt-1"
              type="number"
              min={1}
              max={31}
              value={closingDay}
              onChange={(e) => setClosingDay(e.target.value)}
              placeholder="31=末日"
            />
          </label>
          <label className="text-xs text-muted-foreground">
            支払日
            <input
              className="input mt-1"
              type="number"
              min={1}
              max={31}
              value={paymentDay}
              onChange={(e) => setPaymentDay(e.target.value)}
            />
          </label>
          <label className="text-xs text-muted-foreground">
            支払月オフセット
            <input
              className="input mt-1"
              type="number"
              min={0}
              max={6}
              value={offset}
              onChange={(e) => setOffset(e.target.value)}
            />
          </label>
        </div>
      )}
      <input
        className="input"
        value={bank}
        onChange={(e) => setBank(e.target.value)}
        placeholder="引落口座（任意）"
      />
      <div className="flex gap-2">
        <button
          className="btn-primary text-sm flex-1"
          disabled={pending}
          onClick={() => {
            start(async () => {
              try {
                await upsertPaymentMethod({
                  id: method.id,
                  user_id: userId || null,
                  name,
                  type: method.type,
                  closing_day: closingDay ? Number(closingDay) : null,
                  payment_day: paymentDay ? Number(paymentDay) : null,
                  payment_month_offset: offset ? Number(offset) : 1,
                  bank_account_label: bank || null,
                  display_order: method.display_order,
                });
                setEditing(false);
              } catch (e: unknown) {
                onError(e instanceof Error ? e.message : String(e));
              }
            });
          }}
        >
          保存
        </button>
        <button
          className="btn-ghost text-sm"
          onClick={() => setEditing(false)}
        >
          キャンセル
        </button>
      </div>
    </li>
  );
}

function AddPaymentMethodForm({
  users,
  start,
  onError,
  pending,
}: {
  users: UserRow[];
  start: (fn: () => void) => void;
  onError: (e: string | null) => void;
  pending: boolean;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<PaymentMethodRow["type"]>("credit_card");
  const [userId, setUserId] = useState("");
  const [closingDay, setClosingDay] = useState("");
  const [paymentDay, setPaymentDay] = useState("");
  const [offset, setOffset] = useState("1");

  return (
    <form
      className="mt-4 pt-4 border-t border-border space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        start(async () => {
          try {
            await upsertPaymentMethod({
              user_id: userId || null,
              name: name.trim(),
              type,
              closing_day: type === "credit_card" && closingDay ? Number(closingDay) : null,
              payment_day: type === "credit_card" && paymentDay ? Number(paymentDay) : null,
              payment_month_offset: type === "credit_card" ? Number(offset || "1") : 0,
              display_order: 99,
            });
            setName("");
            setClosingDay("");
            setPaymentDay("");
            setOffset("1");
          } catch (e: unknown) {
            onError(e instanceof Error ? e.message : String(e));
          }
        });
      }}
    >
      <div className="grid grid-cols-2 gap-2">
        <input
          className="input"
          placeholder="名称（例: AMEX Bonvoy）"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <select
          className="input"
          value={type}
          onChange={(e) => setType(e.target.value as PaymentMethodRow["type"])}
        >
          <option value="credit_card">クレジットカード</option>
          <option value="cash">現金</option>
          <option value="transfer">振込</option>
        </select>
      </div>
      <select className="input" value={userId} onChange={(e) => setUserId(e.target.value)}>
        <option value="">共同</option>
        {users.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name}
          </option>
        ))}
      </select>
      {type === "credit_card" && (
        <div className="grid grid-cols-3 gap-2">
          <input
            className="input"
            type="number"
            min={1}
            max={31}
            placeholder="締め日 (31=末日)"
            value={closingDay}
            onChange={(e) => setClosingDay(e.target.value)}
          />
          <input
            className="input"
            type="number"
            min={1}
            max={31}
            placeholder="支払日"
            value={paymentDay}
            onChange={(e) => setPaymentDay(e.target.value)}
          />
          <input
            className="input"
            type="number"
            min={0}
            max={6}
            placeholder="支払月オフセット"
            value={offset}
            onChange={(e) => setOffset(e.target.value)}
          />
        </div>
      )}
      <button className="btn-primary w-full" disabled={pending}>
        追加
      </button>
    </form>
  );
}

function BulkPaymentMethodAssign({
  users,
  methods,
  start,
  onError,
  pending,
}: {
  users: UserRow[];
  methods: PaymentMethodRow[];
  start: (fn: () => void) => void;
  onError: (e: string | null) => void;
  pending: boolean;
}) {
  const [paymentMethodId, setPaymentMethodId] = useState<string>("");
  const [userId, setUserId] = useState<string>("");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [onlyUnassigned, setOnlyUnassigned] = useState(true);
  const [result, setResult] = useState<string | null>(null);

  if (methods.length === 0) return null;

  return (
    <div className="mt-6 pt-4 border-t border-border space-y-3">
      <div>
        <h3 className="font-semibold text-sm">過去の取引に支払方法を一括で付与</h3>
        <p className="text-xs text-muted-foreground">
          期間とカードを指定して、まだ未分類のトランザクションをまとめて紐付けます。クレカの過去利用分を埋めるのに使います。
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <select
          className="input"
          value={paymentMethodId}
          onChange={(e) => setPaymentMethodId(e.target.value)}
        >
          <option value="">支払方法を選択</option>
          {methods.map((m) => {
            const owner = m.user_id ? users.find((u) => u.id === m.user_id)?.name ?? "" : "共同";
            return (
              <option key={m.id} value={m.id}>
                {m.name}（{owner}）
              </option>
            );
          })}
        </select>
        <select className="input" value={userId} onChange={(e) => setUserId(e.target.value)}>
          <option value="">支払者: 全員</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              支払者: {u.name}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs text-muted-foreground">
          開始日
          <input
            type="date"
            className="input mt-1"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="text-xs text-muted-foreground">
          終了日
          <input
            type="date"
            className="input mt-1"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={onlyUnassigned}
          onChange={(e) => setOnlyUnassigned(e.target.checked)}
        />
        まだ支払方法が未設定のトランザクションのみ
      </label>
      <button
        className="btn-primary text-sm w-full"
        disabled={pending || !paymentMethodId || !from || !to}
        onClick={() => {
          if (!confirm(`${from} 〜 ${to} の取引に「${methods.find((m) => m.id === paymentMethodId)?.name}」を一括で付与します。よろしいですか？`)) return;
          start(async () => {
            try {
              const updated = await bulkAssignPaymentMethod({
                payment_method_id: paymentMethodId,
                user_id: userId || null,
                date_from: from,
                date_to: to,
                only_unassigned: onlyUnassigned,
              });
              setResult(`${updated} 件のトランザクションに付与しました。`);
            } catch (e: unknown) {
              onError(e instanceof Error ? e.message : String(e));
            }
          });
        }}
      >
        一括付与
      </button>
      {result && <p className="text-xs text-success">{result}</p>}
    </div>
  );
}

/* -------------------- Household settings (name + invitations + switcher) -------------------- */
function HouseholdSettings({
  household,
  memberships,
  users,
  paymentMethods,
  start,
  onError,
  pending,
}: {
  household: HouseholdMembership;
  memberships: HouseholdMembership[];
  users: UserRow[];
  paymentMethods: PaymentMethodRow[];
  start: (fn: () => void) => void;
  onError: (e: string | null) => void;
  pending: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState(household.household.name);
  const [defaultUserId, setDefaultUserId] = useState<string>(
    household.household.default_user_id ?? "",
  );
  const [defaultPmId, setDefaultPmId] = useState<string>(
    household.household.default_payment_method_id ?? "",
  );
  const defaultsDirty =
    (household.household.default_user_id ?? "") !== defaultUserId ||
    (household.household.default_payment_method_id ?? "") !== defaultPmId;
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"owner" | "editor" | "viewer">("editor");
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [members, setMembers] = useState<MemberRow[] | null>(null);
  const [invitations, setInvitations] = useState<InvitationRow[] | null>(null);
  const [copiedTokenId, setCopiedTokenId] = useState<string | null>(null);
  const [showTour, setShowTour] = useState(false);
  const isOwner = household.role === "owner";

  // Load members + pending invitations on mount + after any mutation
  const reload = () => {
    listMembers().then(setMembers).catch((e) => onError(String(e)));
    listInvitations().then(setInvitations).catch((e) => onError(String(e)));
  };
  useEffect(() => { reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [household.household_id]);

  function buildInviteUrl(token: string): string {
    return `${window.location.origin}/invite/${token}`;
  }

  return (
    <section className="card space-y-6">
      {showTour && <OnboardingTour onClose={() => setShowTour(false)} />}
      <div>
        <h2 className="font-semibold mb-2">世帯名</h2>
        <div className="flex gap-2 items-center">
          <input
            className="input flex-1"
            value={name}
            disabled={!isOwner}
            onChange={(e) => setName(e.target.value)}
            placeholder="世帯名"
          />
          <button
            className="btn-primary text-sm"
            disabled={pending || !isOwner || name.trim() === household.household.name}
            onClick={() =>
              start(async () => {
                onError(null);
                try {
                  await renameHousehold({ name: name.trim() });
                  router.refresh();
                } catch (e: unknown) {
                  onError(e instanceof Error ? e.message : String(e));
                }
              })
            }
          >
            保存
          </button>
        </div>
        {!isOwner && (
          <p className="text-xs text-muted-foreground mt-1">変更はオーナーのみ可能です。</p>
        )}
      </div>

      <div>
        <h2 className="font-semibold mb-1">取引入力のデフォルト</h2>
        <p className="text-xs text-muted-foreground mb-3">
          ホームタブで取引を入力する際に最初から選ばれている支払者とクレジットカードを指定できます。空欄なら「先頭のメンバー」「未選択」になります。
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="text-xs space-y-1">
            <span className="font-medium">デフォルトの支払者</span>
            <select
              className="input"
              value={defaultUserId}
              onChange={(e) => setDefaultUserId(e.target.value)}
              disabled={pending}
            >
              <option value="">— 未指定 —</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </label>
          <label className="text-xs space-y-1">
            <span className="font-medium">デフォルトの支払方法</span>
            <select
              className="input"
              value={defaultPmId}
              onChange={(e) => setDefaultPmId(e.target.value)}
              disabled={pending}
            >
              <option value="">— 未指定 —</option>
              {paymentMethods
                .filter((m) => !m.archived)
                .map((m) => {
                  const owner = m.user_id
                    ? users.find((u) => u.id === m.user_id)?.name
                    : null;
                  return (
                    <option key={m.id} value={m.id}>
                      {m.name}
                      {owner ? `（${owner}）` : "（共同）"}
                    </option>
                  );
                })}
            </select>
          </label>
        </div>
        <button
          className="btn-primary text-sm mt-2"
          disabled={pending || !defaultsDirty}
          onClick={() =>
            start(async () => {
              onError(null);
              try {
                await updateHouseholdDefaults({
                  default_user_id: defaultUserId || null,
                  default_payment_method_id: defaultPmId || null,
                });
                router.refresh();
              } catch (e: unknown) {
                onError(e instanceof Error ? e.message : String(e));
              }
            })
          }
        >
          保存
        </button>
      </div>

      <div>
        <h2 className="font-semibold mb-1">アプリの使い方</h2>
        <p className="text-xs text-muted-foreground mb-2">
          初回サインアップ時に表示されたツアーを再生します。
        </p>
        <button
          type="button"
          className="btn-ghost text-sm"
          onClick={() => setShowTour(true)}
        >
          ツアーをもう一度見る
        </button>
      </div>

      {memberships.length > 1 && (
        <div>
          <h2 className="font-semibold mb-2">所属世帯</h2>
          <ul className="space-y-1 text-sm">
            {memberships.map((m) => (
              <li key={m.household_id} className="flex items-center gap-2">
                <span className="flex-1">
                  {m.household.name}
                  <span className="text-xs text-muted-foreground ml-1">({m.role})</span>
                </span>
                {m.household_id === household.household_id ? (
                  <span className="chip bg-primary/15 text-primary text-xs">アクティブ</span>
                ) : (
                  <button
                    className="btn-ghost text-xs"
                    onClick={() =>
                      start(async () => {
                        try {
                          await switchHousehold(m.household_id);
                          router.refresh();
                        } catch (e: unknown) {
                          onError(e instanceof Error ? e.message : String(e));
                        }
                      })
                    }
                  >
                    切り替え
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h2 className="font-semibold mb-2">現在のメンバー</h2>
        {members === null ? (
          <p className="text-xs text-muted-foreground">読込中…</p>
        ) : members.length === 0 ? (
          <p className="text-xs text-muted-foreground">メンバーがいません。</p>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {members.map((m) => {
              const isMe = household.role && memberships.some(
                (x) => x.household_id === household.household_id && x.role === m.role && x.display_name === m.display_name,
              );
              return (
                <li key={m.auth_user_id} className="py-2 flex items-center gap-2 min-w-0">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">
                      {m.display_name || m.email || "メンバー"}
                      {isMe && <span className="text-xs text-muted-foreground ml-1">（あなた）</span>}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">{m.email ?? "—"}</div>
                  </div>
                  {isOwner ? (
                    <select
                      className="input text-xs py-1 shrink-0 w-24"
                      value={m.role}
                      disabled={pending}
                      onChange={(e) =>
                        start(async () => {
                          onError(null);
                          try {
                            await changeMemberRole({
                              authUserId: m.auth_user_id,
                              role: e.target.value as "owner" | "editor" | "viewer",
                            });
                            reload();
                          } catch (err: unknown) {
                            onError(err instanceof Error ? err.message : String(err));
                            reload();
                          }
                        })
                      }
                    >
                      <option value="owner">オーナー</option>
                      <option value="editor">編集可</option>
                      <option value="viewer">閲覧のみ</option>
                    </select>
                  ) : (
                    <span className="chip bg-muted text-xs shrink-0">
                      {m.role === "owner" ? "オーナー" : m.role === "editor" ? "編集可" : "閲覧のみ"}
                    </span>
                  )}
                  {(isOwner || isMe) && (
                    <button
                      className="btn-danger text-xs py-1 px-2 shrink-0"
                      disabled={pending}
                      onClick={() => {
                        const msg = isMe
                          ? "この世帯から退出しますか？（自分のメンバー権限のみ削除されます）"
                          : `${m.display_name || m.email} を世帯から削除しますか？`;
                        if (!confirm(msg)) return;
                        start(async () => {
                          onError(null);
                          try {
                            await removeMember(m.auth_user_id);
                            if (isMe) {
                              window.location.href = "/login";
                            } else {
                              reload();
                            }
                          } catch (err: unknown) {
                            onError(err instanceof Error ? err.message : String(err));
                          }
                        });
                      }}
                    >
                      {isMe ? "退出" : "削除"}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {isOwner && invitations !== null && invitations.length > 0 && (
        <div>
          <h2 className="font-semibold mb-2">未承認の招待</h2>
          <ul className="divide-y divide-border text-sm">
            {invitations.map((inv) => {
              const url = buildInviteUrl(inv.token);
              const expired = new Date(inv.expires_at) < new Date();
              return (
                <li key={inv.id} className="py-2 space-y-1 min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{inv.email}</div>
                      <div className="text-xs text-muted-foreground">
                        {inv.role === "owner" ? "オーナー" : inv.role === "editor" ? "編集可" : "閲覧のみ"}
                        {" · "}
                        {expired ? (
                          <span className="text-destructive">期限切れ</span>
                        ) : (
                          `期限: ${new Date(inv.expires_at).toLocaleString("ja-JP")}`
                        )}
                      </div>
                    </div>
                    <button
                      className="btn-ghost text-xs py-1 px-2 shrink-0"
                      onClick={() => {
                        navigator.clipboard?.writeText(url);
                        setCopiedTokenId(inv.id);
                        setTimeout(() => setCopiedTokenId((c) => (c === inv.id ? null : c)), 2000);
                      }}
                    >
                      {copiedTokenId === inv.id ? "✓ コピー済" : "リンクコピー"}
                    </button>
                    <button
                      className="btn-danger text-xs py-1 px-2 shrink-0"
                      disabled={pending}
                      onClick={() => {
                        if (!confirm(`${inv.email} の招待を取り消しますか？`)) return;
                        start(async () => {
                          onError(null);
                          try {
                            await revokeInvitation(inv.id);
                            reload();
                          } catch (err: unknown) {
                            onError(err instanceof Error ? err.message : String(err));
                          }
                        });
                      }}
                    >
                      取消
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {isOwner && (
        <div>
          <h2 className="font-semibold mb-2">メンバーを招待</h2>
          <p className="text-xs text-muted-foreground mb-2">
            メールアドレス宛のリンクで招待します。受け取った人はリンクを開いて Magic Link でログインすると、この世帯に追加されます。
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input
              type="email"
              className="input sm:col-span-2"
              placeholder="invitee@example.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
            />
            <select
              className="input"
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as "owner" | "editor" | "viewer")}
            >
              <option value="editor">編集可</option>
              <option value="viewer">閲覧のみ</option>
              <option value="owner">オーナー</option>
            </select>
          </div>
          <button
            className="btn-primary text-sm mt-2"
            disabled={pending || !inviteEmail.trim()}
            onClick={() =>
              start(async () => {
                onError(null);
                setInviteLink(null);
                try {
                  const { token } = await inviteMember({
                    email: inviteEmail.trim(),
                    role: inviteRole,
                  });
                  setInviteLink(buildInviteUrl(token));
                  setInviteEmail("");
                  reload();
                } catch (e: unknown) {
                  onError(e instanceof Error ? e.message : String(e));
                }
              })
            }
          >
            招待リンクを発行
          </button>
          {inviteLink && (
            <div className="mt-2 rounded-lg border border-border bg-muted/50 p-3 text-xs space-y-1">
              <div className="font-medium">招待リンクを発行しました（14日間有効）：</div>
              <div className="break-all font-mono">{inviteLink}</div>
              <button
                className="btn-ghost text-xs mt-1"
                onClick={() => {
                  navigator.clipboard?.writeText(inviteLink);
                }}
              >
                コピー
              </button>
              <p className="text-muted-foreground">
                招待相手にこのリンクを送ってください。リンクを開いてメールアドレスでログインすると、この世帯に参加できます。
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
