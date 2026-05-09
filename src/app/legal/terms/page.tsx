import Link from "next/link";

export const metadata = {
  title: "利用規約 | 家計簿",
};

export default function TermsPage() {
  return (
    <article className="max-w-2xl mx-auto px-2 sm:px-4 py-6 space-y-4 text-sm leading-relaxed">
      <header>
        <h1 className="text-2xl font-bold">利用規約</h1>
        <p className="text-xs text-muted-foreground">最終更新: 2026年5月10日</p>
      </header>

      <p>
        本利用規約（以下「本規約」）は、本 OSS 家計簿アプリ（以下「本サービス」）の利用条件を定めるものです。ユーザーは本サービスを利用することにより、本規約に同意したものとみなされます。
      </p>

      <h2 className="text-lg font-semibold mt-6">1. サービス内容</h2>
      <p>
        本サービスは家計の記録・集計を目的とした個人向け Web アプリで、ソースコードは MIT ライセンスのもと OSS として公開されています。
      </p>

      <h2 className="text-lg font-semibold mt-6">2. アカウント</h2>
      <ul className="list-disc list-inside space-y-1">
        <li>ユーザーは正確な情報を提供する責任を負います。</li>
        <li>パスワード・認証情報の管理はユーザー自身の責任で行います。</li>
        <li>1 アカウントを複数人で共有することは推奨されません。</li>
      </ul>

      <h2 className="text-lg font-semibold mt-6">3. 禁止事項</h2>
      <ul className="list-disc list-inside space-y-1">
        <li>法令または公序良俗に違反する行為</li>
        <li>本サービスの運営を妨害する行為（過度なリクエスト、脆弱性攻撃 等）</li>
        <li>他のユーザーのアカウント・データへの不正アクセス</li>
        <li>本サービスを通じた他者への嫌がらせ・迷惑行為</li>
      </ul>

      <h2 className="text-lg font-semibold mt-6">4. 免責事項</h2>
      <p>
        本サービスは現状有姿（"as is"）で提供され、明示・黙示を問わず一切の保証をしません。本サービスの利用または利用不能から生じたいかなる損害（データ損失、誤った集計結果、機会損失等を含む）について、開発者・運営者は責任を負いません。
      </p>

      <h2 className="text-lg font-semibold mt-6">5. データの取り扱い</h2>
      <p>
        ユーザーが入力したデータの取り扱いは別途{" "}
        <Link href="/legal/privacy" className="text-primary underline">
          プライバシーポリシー
        </Link>
        に従います。
      </p>

      <h2 className="text-lg font-semibold mt-6">6. サービス提供の停止 / 終了</h2>
      <p>
        運営者は事前の通知なく本サービスの提供内容を変更・停止・終了する場合があります。OSS 提供のため、ユーザーは自身でホスティングして利用継続することが可能です。
      </p>

      <h2 className="text-lg font-semibold mt-6">7. 規約の変更</h2>
      <p>
        本規約は予告なく変更される場合があります。変更後の規約は本ページに掲載された時点で効力を持ちます。
      </p>

      <p className="mt-8">
        <Link href="/" className="text-primary underline">
          ← ホームに戻る
        </Link>
      </p>
    </article>
  );
}
