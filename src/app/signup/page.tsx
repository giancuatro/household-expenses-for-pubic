"use client";

import { useState } from "react";
import Link from "next/link";
import { getSupabaseBrowser } from "@/lib/supabase/browser";
import { bootstrapHousehold } from "../actions/auth";

/**
 * Email + password signup. Flow:
 *   1. supabase.auth.signUp({ email, password })
 *      - With "Confirm email" disabled in Supabase Auth settings, this
 *        returns a session cookie immediately. The user is logged in.
 *      - With "Confirm email" enabled, signUp() returns a user but no
 *        session; we surface a message asking them to click the email link.
 *   2. Server action bootstrapHousehold() creates the household, member,
 *      default categories and payer-label row.
 *   3. router.replace("/") lands on the home screen.
 */
export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [householdName, setHouseholdName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [needConfirm, setNeedConfirm] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const trimmedHh = householdName.trim();
    if (!trimmedHh) {
      setError("世帯名を入力してください。");
      setLoading(false);
      return;
    }
    if (password.length < 8) {
      setError("パスワードは 8 文字以上にしてください。");
      setLoading(false);
      return;
    }

    const sb = getSupabaseBrowser();
    const { data, error: signErr } = await sb.auth.signUp({
      email: email.trim(),
      password,
    });
    if (signErr) {
      setLoading(false);
      setError(signErr.message);
      return;
    }
    if (!data.session) {
      // Confirm email is enabled — user must verify before logging in.
      setLoading(false);
      setNeedConfirm(true);
      return;
    }
    try {
      await bootstrapHousehold({
        householdName: trimmedHh,
        displayName: displayName.trim() || undefined,
      });
      // Use full reload instead of router.replace + router.refresh.
      // Soft nav in Next.js 14.2.15 has a known replaceState() loop bug
      // (#65770); a hard nav forces a clean full request lifecycle.
      window.location.href = "/";
    } catch (err: unknown) {
      setLoading(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="relative min-h-[85vh] flex items-center justify-center overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/15 via-background to-background"
      />
      <form
        onSubmit={onSubmit}
        className="relative w-full max-w-sm rounded-2xl border border-border bg-card/90 backdrop-blur shadow-xl p-6 space-y-5"
      >
        <div className="space-y-1">
          <div className="inline-flex items-center justify-center rounded-2xl bg-primary/15 text-primary w-12 h-12 text-xl font-bold mb-2">
            ¥
          </div>
          <h1 className="text-2xl font-bold tracking-tight">世帯を新規作成</h1>
          <p className="text-sm text-muted-foreground">
            あなたが最初のメンバーとなり、後から家族や同居人を招待できます。
          </p>
        </div>

        {needConfirm ? (
          <p className="rounded-lg border border-success/30 bg-success/10 px-3 py-3 text-sm">
            <strong>{email}</strong> 宛に確認メールを送りました。メール内のリンクを開いてアカウント有効化を完了してください。
          </p>
        ) : (
          <>
            <label className="block space-y-1">
              <span className="text-sm font-medium">世帯名</span>
              <input
                type="text"
                required
                className="input"
                placeholder="例: 山田家"
                value={householdName}
                onChange={(e) => setHouseholdName(e.target.value)}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-sm font-medium">あなたの表示名（任意）</span>
              <input
                type="text"
                className="input"
                placeholder="例: 太郎"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-sm font-medium">メールアドレス</span>
              <input
                type="email"
                required
                className="input"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-sm font-medium">パスワード</span>
              <input
                type="password"
                required
                minLength={8}
                className="input"
                placeholder="8 文字以上"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            {error && (
              <p
                role="alert"
                className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {error}
              </p>
            )}
            <button type="submit" className="btn-primary w-full" disabled={loading}>
              {loading ? "作成中..." : "アカウント作成"}
            </button>
            <p className="text-xs text-muted-foreground text-center">
              既にアカウントをお持ちの方は{" "}
              <Link href="/login" className="text-primary underline">
                ログイン
              </Link>
            </p>
          </>
        )}
      </form>
    </div>
  );
}
