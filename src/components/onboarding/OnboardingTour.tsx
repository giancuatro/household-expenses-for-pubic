"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Copy, Users, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { completeOnboarding } from "@/app/actions/auth";
import { createOpenInvite } from "@/app/actions/settings";
import { CashFlowIllustration } from "./illustrations/CashFlowIllustration";
import { CreditCardIllustration } from "./illustrations/CreditCardIllustration";
import { InvestmentLinkIllustration } from "./illustrations/InvestmentLinkIllustration";

type Mode = "household" | "individual" | null;

type Slide = {
  illustration: React.ComponentType;
  title: string;
  body: React.ReactNode;
};

const SLIDES: Slide[] = [
  {
    illustration: CashFlowIllustration,
    title: "現金スナップショットで残高を追跡",
    body: (
      <>
        現在の現金残高（銀行・財布合算）を 1 度入力するだけで、その後の収入・支出・カード引落を自動加減算してリアルタイム残高が表示されます。残高がずれたら新しいスナップショットを追加して再アンカーできます。
      </>
    ),
  },
  {
    illustration: CreditCardIllustration,
    title: "クレカの締め日と支払日でキャッシュフロー予測",
    body: (
      <>
        クレジットカードに締め日・支払日・支払月オフセットを設定すると、カード請求のタイミングを正確に反映した 60 日先までの現金残高予測が見られます。「来月の引落で残高は足りるか？」が一目でわかります。
      </>
    ),
  },
  {
    illustration: InvestmentLinkIllustration,
    title: "投資の売買が自動で現金残高に反映",
    body: (
      <>
        投資タブで売買を記録すると、買い＝支出 / 売り＝収入として家計簿側にも自動でリンクされ、現金残高とキャッシュフロー予測の両方に反映されます。投資と家計を二重入力する必要はありません。
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
