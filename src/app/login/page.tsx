"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { getSupabaseBrowser } from "@/lib/supabase/browser";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

/**
 * Restrict ?next= to in-app paths to prevent open-redirect attacks.
 * `https://evil.example` and `//evil.example` both fall back to `/`.
 */
function safeNext(raw: string | null | undefined): string {
  if (!raw) return "/";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}

// Mirrors the signup defenses (see src/app/signup/page.tsx). Without these,
// /login is a free password-spraying surface — Supabase rate-limits per IP
// but a distributed botnet can still try thousands of (email, password)
// pairs. Honeypot catches naive form fillers; time gate catches scripted
// submits. Both fail closed silently with a generic error.
const LOGIN_MIN_FILL_MS = 1500;

function LoginForm() {
  const search = useSearchParams();
  const next = safeNext(search?.get("next"));
  const callbackError = search?.get("error") || null;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [error, setError] = useState<string | null>(callbackError);
  const [loading, setLoading] = useState(false);
  const mountedAtRef = useRef<number>(0);

  useEffect(() => {
    mountedAtRef.current = Date.now();
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const elapsed = Date.now() - (mountedAtRef.current || Date.now());
    if (honeypot.trim().length > 0 || elapsed < LOGIN_MIN_FILL_MS) {
      // Pretend the credentials were wrong. Don't disclose the threshold.
      setLoading(false);
      setError("メールアドレスまたはパスワードが正しくありません。");
      return;
    }

    const sb = getSupabaseBrowser();
    const { error: signErr } = await sb.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (signErr) {
      setLoading(false);
      setError(signErr.message);
      return;
    }
    // Hard nav so the new auth cookies trigger a full SSR pass on the
    // landing page (avoids #65770 replaceState() loop on Next.js 14.2.15).
    window.location.href = next;
  }

  async function onGoogle() {
    const sb = getSupabaseBrowser();
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
    const { error: oauthErr } = await sb.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });
    if (oauthErr) setError(oauthErr.message);
  }

  return (
    <div className="relative min-h-[85vh] flex items-center justify-center overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/15 via-background to-background"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-32 -right-32 h-72 w-72 rounded-full bg-primary/20 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-32 -left-32 h-72 w-72 rounded-full bg-success/15 blur-3xl"
      />

      <form
        onSubmit={onSubmit}
        className="relative w-full max-w-sm rounded-2xl border border-border bg-card/90 backdrop-blur shadow-xl p-6 space-y-5"
      >
        {/* Honeypot — invisible to humans, populated by naive form-fill bots. */}
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
          <h1 className="text-2xl font-bold tracking-tight">家計簿にログイン</h1>
          <p className="text-sm text-muted-foreground">
            メールアドレスとパスワードでログインします。
          </p>
        </div>

        <label className="block space-y-1">
          <span className="text-sm font-medium">メールアドレス</span>
          <input
            type="email"
            required
            className="input"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
          />
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium">パスワード</span>
          <input
            type="password"
            required
            className="input"
            placeholder="パスワード"
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
          {loading ? "確認中..." : "ログイン"}
        </button>

        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex-1 h-px bg-border" />
          <span>または</span>
          <span className="flex-1 h-px bg-border" />
        </div>

        <button type="button" onClick={onGoogle} className="btn-secondary w-full">
          Google でログイン
        </button>

        <p className="text-xs text-muted-foreground text-center">
          初めての方は{" "}
          <Link href="/signup" className="text-primary underline">
            世帯を新規作成
          </Link>
        </p>
      </form>
    </div>
  );
}
