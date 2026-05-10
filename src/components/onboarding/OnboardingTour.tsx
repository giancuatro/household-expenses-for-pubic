"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Copy, Users, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { completeOnboarding } from "@/app/actions/auth";
import { createOpenInvite } from "@/app/actions/settings";
import { RecordTransactionIllustration } from "./illustrations/RecordTransactionIllustration";
import { HouseholdSharingIllustration } from "./illustrations/HouseholdSharingIllustration";
import { MonthlyReportIllustration } from "./illustrations/MonthlyReportIllustration";
import { DashboardIllustration } from "./illustrations/DashboardIllustration";
import { CashFlowIllustration } from "./illustrations/CashFlowIllustration";
import { InvestmentLinkIllustration } from "./illustrations/InvestmentLinkIllustration";

type Mode = "household" | "individual" | null;

type Slide = {
  illustration: React.ComponentType;
  title: string;
  body: React.ReactNode;
};

const SLIDES: Slide[] = [
  {
    illustration: RecordTransactionIllustration,
    title: "+ ボタンから収支を 3 ステップで記録",
    body: (
      <>
        画面右下の <strong>＋</strong> ボタンを押すと、入力シートが下から開きます。①支払い者 → ②金額 → ③種類・項目 を選んで「保存」を押すと、即座に取引一覧の先頭に新しい行が追加されます。収入・支出・特別費・投資もすべてここから入力できます。
      </>
    ),
  },
  {
    illustration: HouseholdSharingIllustration,
    title: "世帯メンバーで支出を分けて管理",
    body: (
      <>
        共同支出 / 個人支出 / 立替（他人の分の代表払い）を分けて記録できます。立替は精算済みにマークすると、メンバーごとの「立替差額」と「家計全体の収支」がそれぞれ自動集計され、誰が誰にいくら払うべきかがホーム画面ですぐに分かります。
      </>
    ),
  },
  {
    illustration: MonthlyReportIllustration,
    title: "月次レポートで予算と支出を一覧",
    body: (
      <>
        毎月のサイクル（締め日基準）ごとに、共同変動費の各カテゴリの支出・予算・残額が表として並びます。予算を超えた行は赤くハイライトされ、月初〜月末までの収入・支出・収支も一目で確認できます。前月・前々月への切替も可能。
      </>
    ),
  },
  {
    illustration: DashboardIllustration,
    title: "ダッシュボードで長期トレンドを把握",
    body: (
      <>
        月別の収入・支出・収支の推移、カテゴリ別の月次トレンド、支出割合のドーナツ、予算達成率のヒートマップ（直近 6 ヶ月）、資産推移、キャッシュフロー予測まで、家計全体を多角的に分析できる複数のチャートが揃っています。
      </>
    ),
  },
  {
    illustration: CashFlowIllustration,
    title: "現金残高 + クレカ設定 → CF 予測",
    body: (
      <>
        ❶ 設定で現金残高をスナップショット登録 → ❷ クレジットカードに締め日・支払日を設定 → ❸ ダッシュボードで「今後 60 日のキャッシュフロー予測」が見られます。クレカ引落の段差まで正確に反映されるので、「来月の引落で残高は足りるか」が一目で分かります。
      </>
    ),
  },
  {
    illustration: InvestmentLinkIllustration,
    title: "投資の売買が自動で現金残高に反映",
    body: (
      <>
        投資タブで売買を記録すると、買い＝支出 / 売り＝収入として家計簿側にも自動連動し、現金残高・CF 予測・保有銘柄リストの 3 ヶ所に同時反映されます。投資と家計を二重入力する手間がなく、為替も加重平均で JPY 換算されます。
      </>
    ),
  },
];

type OnboardingTourProps = {
  /**
   * Called when the user finishes or skips. If absent, the tour calls
   * `completeOnboarding()` and `router.refresh()` (the first-launch path).
   * Pass an `onClose` to make the tour replayable from settings without
   * touching the DB or navigation.
   */
  onClose?: () => void;
};

export function OnboardingTour({ onClose }: OnboardingTourProps = {}) {
  const router = useRouter();
  const [step, setStep] = React.useState(0);
  const [mode, setMode] = React.useState<Mode>(null);
  const [link, setLink] = React.useState<string | null>(null);
  const [linkLoading, setLinkLoading] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const [finishing, setFinishing] = React.useState(false);

  const total = SLIDES.length + 1; // +1 final mode-select slide
  const isLast = step === total - 1;

  async function finish() {
    if (finishing) return;
    if (onClose) {
      onClose();
      return;
    }
    setFinishing(true);
    try {
      await completeOnboarding();
    } finally {
      router.refresh();
    }
  }

  async function pickHousehold() {
    setMode("household");
    if (link) return;
    setLinkLoading(true);
    try {
      const { token } = await createOpenInvite({ role: "editor" });
      setLink(`${window.location.origin}/invite/${token}`);
    } catch {
      // Non-fatal; user can still finish onboarding without a link.
    } finally {
      setLinkLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur flex items-center justify-center p-4">
      <div className="relative w-full max-w-md rounded-2xl border border-border bg-card shadow-2xl p-6 space-y-5">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground tabular-nums">
            {step + 1} / {total}
          </span>
          <button
            type="button"
            className="btn-ghost text-xs"
            onClick={finish}
            disabled={finishing}
          >
            スキップ
          </button>
        </div>

        {step < SLIDES.length ? (
          <FeatureSlide slide={SLIDES[step]} />
        ) : (
          <ModeSlide
            mode={mode}
            link={link}
            linkLoading={linkLoading}
            copied={copied}
            onPickHousehold={pickHousehold}
            onPickIndividual={() => setMode("individual")}
            onCopy={async () => {
              if (!link) return;
              await navigator.clipboard.writeText(link);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          />
        )}

        <div className="flex items-center justify-between pt-2">
          <button
            type="button"
            className="btn-ghost text-sm"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0}
          >
            戻る
          </button>
          {!isLast ? (
            <Button onClick={() => setStep((s) => Math.min(total - 1, s + 1))}>
              次へ
            </Button>
          ) : (
            <Button onClick={finish} disabled={finishing || mode === null}>
              {finishing ? "..." : "始める"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function FeatureSlide({ slide }: { slide: Slide }) {
  const Illustration = slide.illustration;
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-border bg-muted/20 overflow-hidden">
        <Illustration />
      </div>
      <h2 className="text-xl font-bold tracking-tight">{slide.title}</h2>
      <p className="text-sm leading-relaxed text-muted-foreground">{slide.body}</p>
    </div>
  );
}

function ModeSlide({
  mode,
  link,
  linkLoading,
  copied,
  onPickHousehold,
  onPickIndividual,
  onCopy,
}: {
  mode: Mode;
  link: string | null;
  linkLoading: boolean;
  copied: boolean;
  onPickHousehold: () => void;
  onPickIndividual: () => void;
  onCopy: () => void;
}) {
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold tracking-tight">この家計簿はどう使いますか？</h2>
      <div className="grid grid-cols-2 gap-2">
        <ModeChoice
          icon={Users}
          title="世帯共同"
          desc="夫婦・家族・同居人と共有"
          active={mode === "household"}
          onClick={onPickHousehold}
        />
        <ModeChoice
          icon={User}
          title="個人で使う"
          desc="自分一人のためのアカウント"
          active={mode === "individual"}
          onClick={onPickIndividual}
        />
      </div>

      {mode === "household" && (
        <div className="rounded-xl border border-border bg-muted/30 p-3 space-y-2">
          <div className="text-xs text-muted-foreground">
            このリンクを共有すると、相手は自分の名前・メール・パスワードでサインアップしてこの世帯に参加できます。
          </div>
          {linkLoading ? (
            <div className="text-xs text-muted-foreground animate-pulse">リンクを発行中...</div>
          ) : link ? (
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded bg-background border border-border px-2 py-1 text-[11px]">
                {link}
              </code>
              <button
                type="button"
                className="btn-ghost text-xs px-2 py-1 inline-flex items-center gap-1"
                onClick={onCopy}
              >
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? "コピー済" : "コピー"}
              </button>
            </div>
          ) : null}
          <div className="text-[11px] text-muted-foreground">
            あとで <Link href="/settings?tab=household" className="text-primary underline">設定 → 世帯</Link> から再発行・追加招待できます。
          </div>
        </div>
      )}

      {mode === "individual" && (
        <div className="rounded-xl border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
          OK。後で世帯共有に切り替えたくなったら、設定からいつでもメンバーを招待できます。
        </div>
      )}
    </div>
  );
}

function ModeChoice({
  icon: Icon,
  title,
  desc,
  active,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  desc: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "rounded-xl border p-3 text-left transition-colors " +
        (active
          ? "border-primary bg-primary/10"
          : "border-border bg-card hover:bg-muted/50")
      }
    >
      <Icon className={"h-5 w-5 mb-1.5 " + (active ? "text-primary" : "text-muted-foreground")} aria-hidden="true" />
      <div className="text-sm font-semibold">{title}</div>
      <div className="text-[11px] text-muted-foreground">{desc}</div>
    </button>
  );
}
