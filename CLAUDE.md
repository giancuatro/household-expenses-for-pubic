# プロジェクト固有ルール — household-expenses-for-public

## デプロイ運用

### 1. 自動プレビュー作業フロー（毎タスク必ず実施）

新機能 / バグ修正 / リファクタなど、**コード変更を伴うタスクが完了したら、ユーザーに指示されなくても自動でプレビュー URL まで届ける**。フローは以下:

1. **ローカル検証**: `npm run typecheck` を必ず通す。UI が変わるなら `npm run build` も確認。
2. **コミット**: 関係ファイルのみを `git add`（`-A` / `.` は使わない）。コミットメッセージは英語の Conventional Commits 風（既存履歴に合わせる）。
3. **ブランチ push**: 現ブランチをそのまま `git push -u origin <branch>`。main 直接 push は禁止。
4. **PR 作成**: `gh pr create` で開く（既存ブランチに PR があれば再利用）。日本語タイトル + 日本語本文（Summary / Migration / Test plan）。
5. **Vercel プレビュー URL 解決**: PR コメントの Vercel bot 出力から `previewUrl` を抽出するか、`gh pr view <N> --json statusCheckRollup` で Vercel context を待つ。
6. **完了報告**: ユーザーに **PR URL とプレビュー URL の両方** をマークダウンリンクで返す。ビルド中の場合はその旨を明示し、`run_in_background` で完了待ちを継続して通知を待つ（追加で sleep ループは作らない）。

ユーザーが「プレビューに上げて」「デプロイして」と毎回言わなくても、上の流れを **デフォルト動作** にする。例外は (a) 設定ファイルや CLAUDE.md だけの変更で実プレビューが不要な時、(b) ユーザーが「コミットしないで」「ローカルで検証だけ」と明示した時のみ。

### 2. Supabase マイグレーション

- 新しいスキーマ変更は `supabase/migrations/<NNNN>_<name>.sql` に追加。番号は既存の最大+1。
- 破壊的変更（drop column / table、型変更、データ削除）はユーザー承認必須（グローバル G.2）。
- マイグレーションを含む PR では、PR 本文の `## Migration` セクションに「Supabase Dashboard で適用が必要」と明記する。

### 3. 投資・株価データ

- SSR で Yahoo Finance を呼ぶ箇所は **必ず `fetchLivePricesWithTimeout()` を使う**。`fetchLivePrices()` を `await` 直書きすると TTFB が遅延し、過去に App Store レビュー級の遅さに退行した。
- クライアント側の自動更新は 5 分インターバル。`app:refresh` イベントを購読すれば PullToRefresh 経由で即時更新できる。

### 4. PullToRefresh

- 全ページ共通機能。`src/components/PullToRefresh.tsx` がレイアウトに常駐。
- ページ固有の追加更新（例: 株価再取得）が必要なら、対象クライアントコンポーネントで `window.addEventListener("app:refresh", ...)` を購読する。**touch リスナーをページ側で重複定義しない**。

### 5. クレジットカード明細インポート

- `cardholder` カラム（`primary` | `family` | NULL）が staging 行にある。PDF / CSV パーサで 本人/家族/配偶者 を検出。
- 家族カード行は妻の個人支出として扱う運用。`bulkCreateFamilyCard` server action が一括登録を担う。
- 新しいカード発行元 PDF を追加する時は `src/lib/csvImport/pdfAuto.ts` の戦略リストに追加し、`card_pdf_format_memory` が学習する仕組みに従う。

### 6. 旅行モード（多通貨 + FX 後追い確定）

- `trips` テーブル + `transactions` の 4 列 (`original_amount` / `original_currency` / `fx_rate` / `fx_status`) + `trip_id`。
- `transactions.amount` は **常に JPY 整数**。`fx_status='pending'` の行は `round(original_amount * fx_rate)` の見積り、`finalized` で実額に置き換わる。
- 旅行中の入力 UI は [src/components/ui/ForeignMoneyInput.tsx](src/components/ui/ForeignMoneyInput.tsx)。`HomeClient` 内で `activeTrip` が prop に乗ったとき自動的に表示。
- カード明細インポートの `runMatcher` に **Pass 1.5** が入っていて、`isPlausibleRate` で為替妥当性をチェックして提案 (confidence 70–90)。`acceptMatch` / `bulkAcceptHighConfidence` / `bulkAcceptFxMatches` で `finalizeFxIfPending` が走る。
- 通貨マスター + 妥当性レンジは [src/lib/currencyList.ts](src/lib/currencyList.ts) 1 ファイルに集約。新規通貨はここに追記すれば全体が拾う。

## ローカル検証コマンド

```bash
npm run typecheck   # tsc --noEmit
npm run build       # 本番ビルド（UI 変更時は推奨）
npm run dev         # 開発サーバー
```

`npm run lint` は ESLint 未設定（対話プロンプトが出る）。

## 参考

- README.md: アーキテクチャ・マルチテナント設計・セットアップ手順
- `supabase/migrations/`: スキーマ履歴（番号順に読むと設計の進化が分かる）
- `src/lib/queries.ts`: 全ての DB 読み込みはここに集約。`unstable_cache` でタグ付け済み。
