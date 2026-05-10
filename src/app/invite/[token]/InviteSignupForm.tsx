"use client";

import { useState } from "react";
import { getSupabaseBrowser } from "@/lib/supabase/browser";

export default function InviteSignupForm({ token }: { token: string }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [needConfirm, setNeedConfirm] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

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
      setError(signErr.message);
      setLoading(false);
      return;
    }
    if (!data.session) {
      // Email confirmation enabled → user must click the link in their inbox.
      setNeedConfirm(true);
      setLoading(false);
      return;
    }

    // Forward to the auth callback so it upserts the membership for this token.
    const params = new URLSearchParams({ invite: token, next: "/" });
    if (name.trim()) params.set("display_name", name.trim());
    window.location.href = `/auth/callback?${params.toString()}`;
  }

  if (needConfirm) {
    return (
      <p className="rounded-lg border border-success/30 bg-success/10 px-3 py-3 text-sm">
        <strong>{email}</strong>{" "}
        宛に確認メールを送りました。メール内のリンクを開いてアカウント有効化を完了すると、自動的にこの世帯に参加できます。
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <label className="block space-y-1">
        <span className="text-sm font-medium">あなたの表示名</span>
        <input
          type="text"
          required
          maxLength={40}
          className="input"
          placeholder="例: 太郎"
          value={name}
          onChange={(e) => setName(e.target.value)}
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
        {loading ? "作成中..." : "参加する"}
      </button>
    </form>
  );
}
