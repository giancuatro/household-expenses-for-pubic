import Link from "next/link";
import { redirect } from "next/navigation";
import { getSupabaseAdmin, getSupabaseServer } from "@/lib/supabase/server";
import InviteSignupForm from "./InviteSignupForm";

export const dynamic = "force-dynamic";

/**
 * Public landing page for an invitation link. Validates the token, then
 * either:
 *  - already-authed user: forwards to /auth/callback to upsert membership;
 *  - anonymous user: shows a name/email/password signup form which posts to
 *    Supabase signUp() and then forwards through /auth/callback with the
 *    invite token preserved.
 */
export default async function InvitePage({
  params,
}: {
  params: { token: string };
}) {
  const token = params.token;
  const admin = getSupabaseAdmin();
  const { data: invite } = await admin
    .from("household_invitations")
    .select("id, household_id, role, email, expires_at, accepted_at, household:households(name)")
    .eq("token", token)
    .maybeSingle();

  const expired = invite?.expires_at
    ? new Date(invite.expires_at as string) < new Date()
    : false;
  const accepted = !!invite?.accepted_at;

  if (!invite || expired || accepted) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center p-4">
        <div className="max-w-sm w-full rounded-2xl border border-border bg-card p-6 text-center space-y-3">
          <h1 className="text-lg font-bold">招待リンクが無効です</h1>
          <p className="text-sm text-muted-foreground">
            {accepted
              ? "このリンクは既に使用されています。"
              : expired
              ? "このリンクは有効期限が切れています。"
              : "このリンクは見つかりませんでした。発行者に再発行を依頼してください。"}
          </p>
          <Link href="/login" className="btn-ghost text-sm">ログインへ</Link>
        </div>
      </div>
    );
  }

  // If already signed in, forward straight to the callback so it upserts
  // membership and redirects home.
  const sb = getSupabaseServer();
  const { data: userData } = await sb.auth.getUser();
  if (userData?.user) {
    redirect(`/auth/callback?invite=${encodeURIComponent(token)}&next=/`);
  }

  const householdName =
    (invite.household as unknown as { name?: string } | null)?.name ?? "世帯";

  return (
    <div className="relative min-h-[85vh] flex items-center justify-center overflow-hidden p-4">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/15 via-background to-background"
      />
      <div className="relative w-full max-w-sm rounded-2xl border border-border bg-card/90 backdrop-blur shadow-xl p-6 space-y-5">
        <div className="space-y-1">
          <div className="inline-flex items-center justify-center rounded-2xl bg-primary/15 text-primary w-12 h-12 text-xl font-bold mb-2">
            ¥
          </div>
          <h1 className="text-2xl font-bold tracking-tight">「{householdName}」に参加</h1>
          <p className="text-sm text-muted-foreground">
            あなたの名前・メール・パスワードを設定するとアカウントが作成され、この世帯のメンバーになります。
          </p>
        </div>
        <InviteSignupForm token={token} />
        <p className="text-xs text-muted-foreground text-center">
          既にアカウントをお持ちの方は{" "}
          <Link
            href={`/login?next=${encodeURIComponent(`/auth/callback?invite=${token}&next=/`)}`}
            className="text-primary underline"
          >
            ログイン
          </Link>
        </p>
      </div>
    </div>
  );
}
