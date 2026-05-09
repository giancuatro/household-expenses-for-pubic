import Link from "next/link";

export const metadata = {
  title: "プライバシーポリシー | 家計簿",
};

export default function PrivacyPage() {
  return (
    <article className="prose-light dark:prose-dark max-w-2xl mx-auto px-2 sm:px-4 py-6 space-y-4 text-sm leading-relaxed">
      <header>
        <h1 className="text-2xl font-bold">プライバシーポリシー</h1>
        <p className="text-xs text-muted-foreground">最終更新: 2026年5月10日</p>
      </header>

      <p>
        本アプリ（以下「本サービス」）は、ユーザーが家計を記録・共有するための OSS Web アプリです。本ポリシーでは、本サービスがどのような情報を収集し、どのように扱うかを説明します。
      </p>

      <h2 className="text-lg font-semibold mt-6">1. 収集する情報</h2>
      <ul className="list-disc list-inside space-y-1">
        <li>メールアドレス（アカウント作成時 / Magic Link 認証時）</li>
        <li>表示名 / 世帯名（任意）</li>
        <li>取引データ（金額・カテゴリ・日付・メモなど、ユーザーが入力したもの）</li>
        <li>IP アドレス・ブラウザ情報（Vercel / Supabase の標準ログ）</li>
      </ul>

      <h2 className="text-lg font-semibold mt-6">2. 利用目的</h2>
      <ul className="list-disc list-inside space-y-1">
        <li>本サービスの機能提供（家計データの保存・表示・集計）</li>
        <li>不正利用検知 / セキュリティ対応</li>
        <li>障害発生時の調査</li>
      </ul>

      <h2 className="text-lg font-semibold mt-6">3. 第三者提供</h2>
      <p>
        ユーザーの個人情報を本人の同意なく第三者に提供することはありません。ただし、以下のインフラサービスを利用しているため、それらの事業者が定めるプライバシーポリシーが適用されます。
      </p>
      <ul className="list-disc list-inside space-y-1">
        <li>
          <a href="https://vercel.com/legal/privacy-policy" target="_blank" rel="noreferrer" className="text-primary underline">Vercel</a>（ホスティング）
        </li>
        <li>
          <a href="https://supabase.com/privacy" target="_blank" rel="noreferrer" className="text-primary underline">Supabase</a>（データベース / 認証）
        </li>
        <li>
          <a href="https://resend.com/legal/privacy-policy" target="_blank" rel="noreferrer" className="text-primary underline">Resend</a>（メール送信、設定している場合）
        </li>
      </ul>

      <h2 className="text-lg font-semibold mt-6">4. データの保管期間</h2>
      <p>
        ユーザーがアカウント削除を実行するまで、本サービスのデータベースに保管されます。アカウント削除リクエスト後は、関連するすべてのデータを物理削除します（30 日以内の遅延あり）。
      </p>

      <h2 className="text-lg font-semibold mt-6">5. ユーザーの権利</h2>
      <p>
        ユーザーは設定画面の「データ管理」タブから以下を実行できます。
      </p>
      <ul className="list-disc list-inside space-y-1">
        <li>自分の世帯データのエクスポート（ZIP / JSON / CSV）</li>
        <li>アカウント / 世帯の削除</li>
      </ul>

      <h2 className="text-lg font-semibold mt-6">6. お問い合わせ</h2>
      <p>
        本ポリシーに関するお問い合わせは、本サービスのリポジトリの Issue 経由でお願いします。
      </p>

      <p className="mt-8">
        <Link href="/" className="text-primary underline">
          ← ホームに戻る
        </Link>
      </p>
    </article>
  );
}
