"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { getSupabaseBrowser } from "@/lib/supabase/browser";
import { bootstrapHousehold } from "../actions/auth";

/**
 * Lightweight anti-bot defenses for the public /signup form.
 *
 * Without an SMTP-verified email confirmation, /signup is the easiest
 * vector for spam-botnets to seed thousands of `auth.users` rows. Two
 * cheap checks shrink that surface dramatically without any external
 * service or domain setup:
 *
 *   1. Honeypot — a hidden `<input>` named "website" that real users
 *      can't see (zero-size + visually hidden + tabIndex=-1). Most
 *      naive form-fill bots populate every input by name; a non-empty
 *      value fails the check.
 *
 *   2. Time gate — track when the page mounted and reject submissions
 *      that arrive in less than 1.5 s. Humans need at least that long
 *      to type even a minimal email + password.
 *
 * Both fail silently (the form pretends to succeed) so attackers don't
 * get a signal to refine. We log nothing identifiable.
 */
const SIGNUP_MIN_FILL_MS = 1500;

/**
 * Signup / household-creation page. Two modes:
 *
 *  A. Anonymous visitor → full signup
 *     1. supabase.auth.signUp({ email, password })
 *        - Confirm email disabled in Supabase: returns a session immediately
 *        - Confirm email enabled: returns a user but no session, surface a
 *          "check your email" message
 *     2. bootstrapHousehold() creates the household + member + categories
 *     3. Hard-nav to "/"
 *
 *  B. Already-authenticated visitor with no household yet (e.g. an email-only
 *     auth.users row left over from a previous half-finished signup, or a
 *     user invited via email-only OAuth before any household was created)
 *     → only ask for household name + display name, skip signUp() entirely.
 *     This is what breaks the redirect loop where requireSession sends
 *     authed-but-householdless users to /signup.
 */
export default function SignupPage() {
  const [authedUser, setAuthedUser] = useState<{ email: string | null } | null | undefined>(undefined);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [householdName, setHouseholdName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [needConfirm, setNeedConfirm] = useState(false);
  const mountedAtRef = useRef<number>(0);

  // Detect already-authed state on mount so we can hide email/password fields
  useEffect(() => {
    mountedAtRef.current = Date.now();
    const sb = getSupabaseBrowser();
    sb.auth.getUser().then(({ data }) => {
      setAuthedUser(data.user ? { email: data.user.email ?? null } : null);
    });
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    // Anti-bot: honeypot field must be empty AND form must have been on
    // screen for at least SIGNUP_MIN_FILL_MS. Fail silently (pretend to
    // succeed) so scrapers don't learn the threshold.
    const elapsed = Date.now() - (mountedAtRef.current || Date.now());
    if (honeypot.trim().length > 0 || elapsed < SIGNUP_MIN_FILL_MS) {
      // Show the fake "check your email" state and stop. No DB writes.
      setLoading(false);
      setNeedConfirm(true);
      return;
    }

    const trimmedHh = householdName.trim();
    if (!trimmedHh) {
      setError("世帯名を入力してください。");
      setLoading(false);
      return;
    }

    // Path B: already authed → straight to bootstrap
    if (authedUser) {
      try {
        await bootstrapHousehold({
          householdName: trimmedHh,
          displayName: displayName.trim() || undefined,
        });
        window.location.href = "/";
      } catch (err: unknown) {
        setLoading(false);
        setError(err instanceof Error ? err.message : String(err));
      }
      return;
    }

    // Path A: anonymous → full signup
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
      setLoading(false);
      setNeedConfirm(true);
      return;
    }
    try {
      await bootstrapHousehold({
        householdName: trimmedHh,
        displayName: displayName.trim() || undefined,
      });
      window.location.href = "/";
    } catch (err: unknown) {
      setLoading(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function onSignOut() {
    const sb = getSupabaseBrowser();
    await sb.auth.signOut();
    window.location.href = "/login";
  }

  // Don't flash content while we're still resolving auth state
  if (authedUser === undefined) {
    return <div className="min-h-[85vh]" />;
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
        {/*
          Honeypot — visually hidden to humans, presented to naive form-fill
          bots as a normal input. Real users never type here, so any value
          flags the submission as automated. Kept off-screen via inline style
          so Tailwind's `display:none` doesn't get tree-shaken away.
        */}
        <div
          aria-hidden="true"
          style={{ position: "absolute", left: "-9999px", top: "-9999px", width: 1, height: 1, overflow: "hidden" }}
        >
          <label>
            Website (leave blank)
            <input
              type="text"
              name="website"
              tabIndex={-1}
              autoComplete="off"
              value={honeypot}
              onChange={(e) => setHoneypot(e.target.value)}
            />
          </label>
        </div>

        <div className="space-y-1">
          <div className="inline-flex items-center justify-center rounded-2xl bg-primary/15 text-primary w-12 h-12 text-xl font-bold mb-2">
            ¥
          </div>
          <h1 className="text-2xl font-bold tracking-tight">世帯を新規作成</h1>
          <p className="text-sm text-muted-foreground">
            {authedUser
              ? `${authedUser.email ?? "あなた"} としてログイン中。世帯を作成して開始します。`
              : "あなたが最初のメンバーとなり、後から家族や同居人を招待できます。"}
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

            {!authedUser && (
              <>
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
              </>
            )}

            {error && (
              <p
                role="alert"
                className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {error}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              アカウントを作成することで{" "}
              <Link href="/legal/terms" target="_blank" className="text-primary underline">利用規約</Link>
              {" "}と{" "}
              <Link href="/legal/privacy" target="_blank" className="text-primary underline">プライバシーポリシー</Link>
              {" "}に同意したものとみなされます。
            </p>
            <button type="submit" className="btn-primary w-full" disabled={loading}>
              {loading ? "作成中..." : authedUser ? "世帯を作成" : "アカウント作成"}
            </button>
            {authedUser ? (
              <p className="text-xs text-muted-foreground text-center">
                別のアカウントを使う場合は{" "}
                <button type="button" onClick={onSignOut} className="text-primary underline">
                  ログアウト
                </button>
              </p>
            ) : (
              <p className="text-xs text-muted-foreground text-center">
                既にアカウントをお持ちの方は{" "}
                <Link href="/login" className="text-primary underline">
                  ログイン
                </Link>
              </p>
            )}
          </>
        )}
      </form>
    </div>
  );
}
