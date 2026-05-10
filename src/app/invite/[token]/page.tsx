import Link from "next/link";
import { redirect } from "next/navigation";
import { getSupabaseAdmin, getSupabaseServer } from "@/lib/supabase/server";
import { acceptInvite } from "@/lib/invite";
import InviteSignupForm from "./InviteSignupForm";

export const dynamic = "force-dynamic";

/**
 * Public landing page for an invitation link. Validates the token, then:
 *
 *   - if the visitor is already signed in → accept the invite directly
 *     server-side (RLS-bypassing admin client) and redirect to "/";
 *   - if anonymous → render the in-page name/email/password signup form.
 *     After signUp succeeds, the form bounces through /auth/callback which
 *     reads the freshly-set session cookie and finishes the acceptance.
 *
 * The route is in middleware.ts PUBLIC_PATHS, so anonymous visitors land
 * here directly instead of being kicked to /login.
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

  // If already signed in, accept the invite directly and send them home.
  // (Going through /auth/callback would also work, but doing it here avoids
  // a redirect hop and works without depending on the callback recognising
  // the existing-session case.)
  const sb = getSupabaseServer();
  const { data: userData } = await sb.auth.getUser();
  if (userData?.user) {
    await acceptInvite({
      token,
      userId: userData.user.id,
      userEmail: userData.user.email ?? null,
      displayName: null,
    });
    redirect("/");
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
