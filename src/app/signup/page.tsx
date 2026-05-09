"use client";

import { useState } from "react";
import Link from "next/link";
import { getSupabaseBrowser } from "@/lib/supabase/browser";

/**
 * Sign-up flow:
 *  1. User enters their email + a household name (e.g. "山田家")
 *  2. Magic link is sent to email
 *  3. /auth/callback exchanges the code, then bootstraps the household + member row
 *
 * The household name is stashed in sessionStorage and passed via the redirect
 * URL so the callback knows whether to create a new household for this user.
 */
export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [householdName, setHouseholdName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const trimmedHh = householdName.trim();
    const trimmedDn = displayName.trim();
    if (!trimmedHh) {
      setError("世帯名を入力してください。");
      setLoading(false);
      return;
    }

    const params = new URLSearchParams({
      next: "/",
      household_name: trimmedHh,
      display_name: trimmedDn || email.split("@")[0],
    });
    const redirectTo = `${window.location.origin}/auth/callback?${params.toString()}`;

    const sb = getSupabaseBrowser();
    const { error } = await sb.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: redirectTo, shouldCreateUser: true },
    });
    setLoading(false);
    if (error) setError(error.message);
    else setSent(true);
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

        {sent ? (
          <p className="rounded-lg border border-success/30 bg-success/10 px-3 py-3 text-sm">
            <strong>{email}</strong> 宛に確認リンクを送りました。リンクをクリックすると世帯「{householdName}」が作成されます。
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
            {error && (
              <p
                role="alert"
                className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {error}
              </p>
            )}
            <button type="submit" className="btn-primary w-full" disabled={loading}>
              {loading ? "送信中..." : "確認リンクを送る"}
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
