# 家計簿 (Household Expense)

**シンプルでマルチユーザー対応の共有家計簿 OSS。**
Next.js 14 + Supabase で動く Web アプリです。世帯（カップル / 家族 / ルームメイト）単位で
家計を分け、メンバーをメール招待で追加できます。

> Phase 1 で「夫婦 1 世帯専用」設計を「マルチテナント SaaS」設計に書き換えました。
> 自分でデプロイすれば自分の世帯ができ、家族・友人を招待して共同で記録できます。
> アプリストアには未公開で、現状は OSS としての提供を主眼にしています。

## 技術スタック

| 層 | 技術 |
| --- | --- |
| フロント / サーバー | **Next.js 14 (App Router)** + TypeScript |
| UI | **Tailwind CSS** + Recharts |
| DB | **Supabase (PostgreSQL)** |
| 認証 | **Supabase Auth** (Email Magic Link / Google OAuth) |
| 認可 | **Row-Level Security** (世帯単位でデータを完全分離) |
| デプロイ | **Vercel** 推奨 |

### マルチテナント設計

- `households` — 1 行 = 1 世帯
- `household_members` — Supabase auth.users と households の中間テーブル（role: owner/editor/viewer）
- `household_invitations` — メールアドレス + トークン形式の招待
- 全データテーブル (`transactions`, `expense_categories`, …) に `household_id` カラムが付き、RLS で `current_household_ids()` 集合に絞り込まれる

---

## セットアップ手順

### 1. Supabase プロジェクトを作成

> **Supabase とは**: PostgreSQL DB + 認証 + ファイルストレージ + リアルタイム購読が 1 セットになったホスティングサービス。本アプリは Postgres と Auth だけ使います。無料プランで個人利用は十分。

#### 1-1. アカウント作成 & 新規プロジェクト

1. <https://supabase.com> にアクセス → 右上 `Start your project` → GitHub アカウントでサインイン推奨
2. 初回ログイン時に **Organization** の作成を求められる:
   - `Name` は任意（例: `your-name-personal`）
   - `Type` は `Personal`、`Plan` は `Free`
3. `New Project` をクリック → プロジェクト設定:
   - **Name**: `household-expense`（任意）
   - **Database Password**: 強いものを 1 つ生成して **必ずパスワードマネージャに保存**。あとで psql 接続するときに使う。失くすと DB password reset から再発行になる
   - **Region**: 自分から物理的に近いリージョン。日本なら `Northeast Asia (Tokyo)` か `Northeast Asia (Seoul)` がレイテンシ◎
   - **Pricing Plan**: `Free`（行数 500MB / 帯域 5GB / Auth users 50,000 まで無料）
4. `Create new project` を押す → プロビジョニングに 1〜2 分かかる。コーヒー☕

> **無料枠の制限**: Free プランは 1 週間アクセスがないとプロジェクトが自動で **一時停止 (paused)** されます（Settings → General で再開可能）。本番運用するなら Pro プラン（$25/月）で auto-pause を無効化、または `cron` で軽くアクセスし続ける運用に。

#### 1-2. API キーを控える

プロジェクト作成完了後、ダッシュボード左サイドバー → `Project Settings`（⚙ アイコン）→ `API` を開く:

| 表示名 | コピー先 .env キー | 用途 |
| --- | --- | --- |
| **Project URL** | `NEXT_PUBLIC_SUPABASE_URL` | `https://xxxxxx.supabase.co` 形式 |
| **Project API keys → anon public** | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | クライアント側でも使えるキー。RLS で守られる |
| **Project API keys → service_role** | `SUPABASE_SERVICE_ROLE_KEY` | **RLS をバイパスする全権キー**。サーバ専用、Git にコミット禁止 |

> **anon と service_role の違い** (重要なメンタルモデル):
> - **anon key** = 「ログインしてないユーザー」の権限。RLS ポリシーを必ず通る。GitHub にコミットしても OK な公開キー。
> - **service_role key** = 「DB の root」。RLS をバイパスする。本アプリではキャッシュ層と auth callback の世帯ブートストラップだけで使う。**ブラウザに絶対渡さない**（環境変数名に `NEXT_PUBLIC_` を付けないことで担保）。

3 つのキーをパスワードマネージャか一時メモに退避。あとで `.env.local` と Vercel の環境変数に貼ります。

#### 1-3. 認証プロバイダの有効化

ダッシュボード左サイドバー → `Authentication`（鍵アイコン）→ `Providers`:

1. **Email** プロバイダ（デフォルトで有効）:
   - `Enable Email provider` が ON になっていることを確認
   - `Confirm email` は **OFF** にしておく（Magic Link 方式は確認メール不要なので、ONだと挙動が混乱する）
   - `Secure email change` は ON のままで OK
   - `Save` を押す
2. **Google** プロバイダ（任意 — Magic Link だけで進めるなら飛ばしてOK）:
   - 1-3-google セクション（後述）を参照

#### 1-3-google. Google OAuth を入れる場合（任意）

1. <https://console.cloud.google.com> にアクセス → プロジェクトを作成（既存があれば選択）
2. 左メニュー `APIs & Services → OAuth consent screen` で:
   - User Type: `External`
   - App name / User support email / Developer contact を入力 → 保存（Test mode のままで OK）
3. `APIs & Services → Credentials → + CREATE CREDENTIALS → OAuth client ID`:
   - Application type: `Web application`
   - **Authorized redirect URIs** に以下を追加（**Vercel の URL ではない、Supabase の callback URL**）:
     ```
     https://<your-supabase-project>.supabase.co/auth/v1/callback
     ```
   - `Create` → Client ID と Client Secret が表示される → コピー
4. Supabase ダッシュボード → `Authentication → Providers → Google` → トグルを ON →
   - `Client ID (for OAuth)` と `Client Secret (for OAuth)` に貼り付け → `Save`

これで `/login` の「Google でログイン」ボタンが動くようになります。

#### 1-4. リダイレクト URL の登録

ダッシュボード → `Authentication → URL Configuration`:

1. **Site URL**: ローカル開発を始めるなら `http://localhost:3000`、Vercel デプロイ後は本番 URL に変更
2. **Redirect URLs** (Allow List): 改行区切りで複数追加可能。次を全部入れておく:
   ```
   http://localhost:3000/auth/callback
   https://your-app.vercel.app/auth/callback
   https://*-your-team.vercel.app/auth/callback
   ```
   - 1 行目: ローカル開発用
   - 2 行目: 本番（Vercel デプロイ後の実 URL に置換）
   - 3 行目: Vercel の Preview デプロイ用ワイルドカード（PR ごとに URL が変わる）
3. `Save changes`

> **なぜこの設定が必須か**: Magic Link メール内のリンクを Supabase が生成するとき、Allow List 外の URL は弾かれます。「クリックしても何も起きない」「`redirect_uri mismatch` エラー」のほぼ全ては この登録漏れが原因。

#### 1-5. SMTP の設定（任意 — 任意でも本番運用には強く推奨）

デフォルトは Supabase 提供の共有 SMTP で、**送信元が `noreply@mail.supabase.io`** になります。Gmail などのスパムフィルタに弾かれることが多く、Magic Link メールが「届かない」現象の主因。

本番運用するなら自前 SMTP を設定:

1. ダッシュボード → `Project Settings → Auth → SMTP Settings` → `Enable Custom SMTP` を ON
2. 推奨プロバイダ:
   - **Resend** (<https://resend.com>) — 月 3,000 通無料、API も SMTP も使える、設定 5 分
   - **SendGrid** — 月 100 通無料、設定がやや煩雑
   - **Amazon SES** — 安い（月 6 万通まで無料 if EC2 / Lambda 経由）が、本番への移行申請が必要
3. プロバイダの SMTP ホスト / ポート / ユーザー / パスワード / 送信元アドレス・名前を入力 → `Save`

ローカル開発で動作確認するだけなら、デフォルト SMTP のままで OK（自分宛に送るぶんには Gmail でも届くことが多い）。

#### 1-6. SQL マイグレーションの実行

ダッシュボード左サイドバー → `SQL Editor` → `+ New query`:

このリポジトリの `supabase/migrations/` 配下のファイルを **番号順に 1 つずつ** 開いて、SQL Editor に貼り付け → `Run` を押す:

| # | ファイル | 内容 |
| --- | --- | --- |
| 1 | `0001_init.sql` | テーブル / enum / 初期シード |
| 2 | `0003_investment_account_id.sql` | 投資テーブルに account_id 追加 |
| 3 | `0004_payment_methods.sql` | 支払方法テーブル + 既存ユーザーへのシード |
| 4 | `0005_cash_balance_and_fixed_cost_pm.sql` | 現金残高 + 固定費の payment_method_id |
| 5 | `0006_fixed_cost_payment_day.sql` | 固定費の payment_day カラム |
| 6 | `0007_advance_settled_at.sql` | 立替精算日カラム |
| 7 | `0010_multi_tenant.sql` | **マルチテナント化** (households / household_members など) |
| 8 | `0011_seed_default_household.sql` | レガシーデータ移行（新規環境では no-op） |
| 9 | `0012_rls.sql` | **Row-Level Security 有効化** |

> **注意**: `0002` 番がスキップされている（過去にロールバックした migration）のは正常です。番号順に詰める必要はなく、ファイル名のソート順がそのまま実行順です。

各ファイルの実行に成功すると `Success. No rows returned` と表示されます。エラーが出たら:
- 既に実行済みの SQL を再実行している場合 → `column already exists` 系の警告が出るが、本リポジトリの migration は `if not exists` で書かれているため基本スルーで OK
- それ以外のエラー → エラー文を読んで対処（Slack なり Issue なり相談を）

#### 1-7. マイグレーション実行の確認

ダッシュボード → `Table Editor` で次のテーブルが揃っているか目視確認:

- `households`, `household_members`, `household_invitations`
- `users`, `expense_categories`, `fixed_cost_masters`
- `payment_methods`, `transactions`
- `investment_accounts`, `investment_holdings`, `investment_transactions`
- `cash_balance_snapshots`

各テーブルの `Auth → Authentication policies` タブを開いて、`<table_name>_household_all` のような名前の RLS ポリシーが付いていることを確認。

これで Supabase 側の準備は完了。次は `.env.local` の設定（手順 2）へ。

### 2. 環境変数

> **環境変数とは**: ソースコードに直書きしたくない秘密情報や環境ごとに変わる設定（DB URL、API キーなど）を、外から注入する仕組み。Next.js は `.env.local` を自動で読み込みます。

#### 2-1. `.env.local` を作成

リポジトリの **ルート直下** で次を実行:

```bash
cp .env.example .env.local
```

これでテンプレートがコピーされる。`.env.local` は `.gitignore` で除外済みなので、編集しても Git にコミットされない安全な置き場です。**`.env`（`.local` なし）を直接編集してはいけません**（Git に乗ってしまう運用ミスの元）。

#### 2-2. 各変数を埋める

エディタで `.env.local` を開いて、手順 1-2 で控えた値に置き換えます:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...（長い JWT）
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...（さらに長い別の JWT）
# CRON_SECRET=  ← 任意。Vercel Cron 使うなら埋める
```

| 変数 | 必須 | 用途 |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | Supabase プロジェクト URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | anon public key（クライアントに露出 OK） |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | service role key（**サーバ専用、Git・ブラウザに漏らさない**） |
| `CRON_SECRET` | 任意 | `/api/cron/*` を Vercel Cron などから叩くときの Bearer トークン |

`CRON_SECRET` を生成したい場合:

```bash
openssl rand -base64 32
```

#### 2-3. `NEXT_PUBLIC_` プレフィックスのルール

Next.js では、環境変数名が `NEXT_PUBLIC_` で始まるものだけがブラウザの JavaScript バンドルに埋め込まれます。それ以外（例: `SUPABASE_SERVICE_ROLE_KEY`）はサーバ側でしか参照できず、`window.process.env.X` で読んでも `undefined` になります。

- ✅ `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` → クライアントで使ってOK
- ❌ `NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY` ← **絶対こうしない**。RLS をバイパスする全権キーが世界に流出する

判断基準: 「これがブラウザの DevTools で見えても問題ないか？」を自問する。No なら `NEXT_PUBLIC_` を付けない。

#### 2-4. 検証

ターミナルで次を実行:

```bash
grep -E "^(NEXT_PUBLIC_SUPABASE|SUPABASE_SERVICE)" .env.local | sed 's/=.*/=<set>/'
```

期待される出力（実値はマスクされます）:

```
NEXT_PUBLIC_SUPABASE_URL=<set>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<set>
SUPABASE_SERVICE_ROLE_KEY=<set>
```

3 行揃っていれば値が入っている証拠。

実際に Next.js が `.env.local` を拾えているかは `npm run dev` のログで確認:

```
▲ Next.js 14.2.15
- Local:        http://localhost:3000
- Environments: .env.local      ← この行が出ていればロード成功
```

ブラウザで `http://localhost:3000` → `/login` 画面が表示されれば、URL / anon key は正しく読めています（読めないと middleware が落ちて 500）。

#### 2-5. セキュリティチェック

- [ ] `.env.local` を `git status` で見て **トラッキングされていない**（`.gitignore` 経由で除外）
- [ ] `git log -p -- .env*` で過去に間違って `.env.local` をコミットしていない
- [ ] Slack / Discord / 公開ドキュメントに `service_role` キーを貼っていない
- [ ] 万が一 service_role キーを漏らしたら、Supabase ダッシュボード → `Settings → API → Reset service_role secret` で即ローテート（古いキーは即座に無効化される）

> **service_role が漏れたときの被害**: RLS をバイパスして `auth.users` を含む全テーブルを読み書きできる = 全ユーザーのメアド・取引履歴が抜かれて、データの改ざん・削除も自由。ローテートまでに数分でも抜かれれば終わりです。Postgres password と同等の重要度で扱ってください。

### 3. ローカル開発

#### 3-1. 依存インストール & 起動

```bash
npm install
npm run dev
# → http://localhost:3000
```

ブラウザで開くと、未ログインなので自動で `/login` にリダイレクトされます。
画面が真っ暗で何も表示されない場合は、`.env.local` に Supabase のキーが入っているか、`npm run dev` のログにエラーが出ていないか確認してください。

#### 3-2. ローカルでの Magic Link 動作確認

「メールアドレスを入力 → 確認リンクを送る」をクリックすると、Supabase が **本物のメールアドレス宛** に確認リンクを送ります。ローカル開発でも実メールが届く設計です。

- 自分宛のメールが届かない場合は、Supabase ダッシュボード → `Authentication → Logs` で送信履歴を確認
- メールが届いても遅い場合は、Supabase の `Authentication → Rate Limits` を一時的に緩めるか、別アドレスを使う
- 開発中に何度もメールを送りたくないときは、Supabase ダッシュボード → `Authentication → Users` 画面で `Invite user` ボタンから手動で auth user を作って、ダッシュボード上の「Magic Link を生成」機能を使うのが楽です

> **メモ**: メール内のリンクは `http://localhost:3000/auth/callback?...` の形になります。Supabase の `Site URL` を `http://localhost:3000` に、`Redirect URLs` に `http://localhost:3000/auth/callback` を登録していないと、リンクをクリックしても本番 URL に飛ばされてしまうので要注意。

#### 3-3. 初回サインアップ（=世帯の新規作成）

1. `/signup` で「世帯名」「あなたの表示名（任意）」「メールアドレス」を入力 → 「確認リンクを送る」
2. 届いたメールのリンクをクリック
3. ブラウザが `/auth/callback?...` を開き、サーバー側で次が自動実行されます:
   - Supabase Auth セッション Cookie がブラウザにセットされる
   - 入力した世帯名で `households` テーブルに 1 行追加
   - あなたを `owner` として `household_members` に登録
   - デフォルトカテゴリ（食費・外食費・移動・日用品・…）を `expense_categories` に投入
   - 表示名を `users` テーブルに「payer ラベル」として登録（取引画面で「誰が払った？」のチョイスとして出てくる）
4. ホーム画面（`/`）に飛ばされる。これでログイン完了

サインアップに失敗したと感じたら、Supabase ダッシュボード → `Table editor` で `households` `household_members` `expense_categories` `users` の 4 テーブルを開き、自分のメアドで作った行が入っているか目視確認できます。

#### 3-4. 動作確認

- ホームでテスト取引を 1 件追加 → 「取引一覧」に表示される
- 設定 → カテゴリでカテゴリを 1 個追加 / 編集 / 削除
- 設定 → 世帯タブで「世帯名」を変更 → ヘッダーが即座に変わる
- ログアウト（設定 → 右上）→ もう一度ログイン → データが残っている

#### 3-5. メンバー招待のローカルテスト

招待リンクは現状「メールで自動送信」ではなく「リンクを発行 → コピーして相手に渡す」方式です（メール送信実装は将来の TODO）。

1. **オーナー側** (= 自分): 設定 → 世帯タブ → 「メンバーを招待」セクション
   - 招待先のメアド（例: `partner@example.com`）と役割（owner / editor / viewer）を選んで「招待リンクを発行」
   - 発行された URL（`http://localhost:3000/auth/callback?invite=<token>&next=/`）が表示される → コピー
2. **招待される側** (= 相手): 別ブラウザ（またはシークレットウィンドウ）でそのリンクを開く
   - `/login` にリダイレクトされるので、招待先メアドで Magic Link を要求
   - メールのリンクを開く → `/auth/callback` がトークンを検証して `household_members` に追加
   - 同じ世帯のデータが見える状態でログイン完了

**ローカルで「相手」を擬似的に作る方法**: メアド `you+test@gmail.com`（プラスエイリアス）を使うと、Gmail なら同じ受信箱に届くので 1 アカウントで両方の役割を試せます。Supabase の auth.users 上では別アカウント扱いになります。

#### 3-6. RLS が効いていることの確認（重要）

「マルチテナント化したけど他人のデータが見えてしまう」と Phase 1 が無意味なので、必ず確認:

1. アカウント A で世帯 A を作って取引を 1 件追加
2. 別ブラウザでアカウント B（別メアド）でサインアップ → 別の世帯 B が自動で作られる
3. アカウント B で `/` を開く → アカウント A の取引が **1 件も見えない** はず
4. Supabase ダッシュボード → `SQL Editor` で次を試して、anon key では他世帯が読めないことを確認:

```sql
-- service_role 接続なので何でも見える
select household_id, count(*) from transactions group by 1;
-- → 世帯 A と世帯 B の両方が出る
```

ログイン状態でブラウザから直接 Supabase REST API を叩いても、自分の世帯以外は 0 件で返ってくるはずです。

---

### 4. Vercel デプロイ

#### 4-1. リポジトリを Vercel にインポート

1. GitHub にこのリポジトリを push（プライベートでも OK）。
2. <https://vercel.com> にログイン → `Add New... → Project` → 該当 GitHub リポジトリを `Import`。
3. **Framework Preset** が `Next.js` で自動認識される。`Build Command` `Output Directory` などはデフォルトのまま。

#### 4-2. 環境変数を登録（最重要）

Vercel の `Project → Settings → Environment Variables` で、以下を **Production / Preview / Development の 3 環境すべて** に設定:

| Name | Value | 注意 |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://xxxx.supabase.co` | クライアントに露出してOK |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `eyJ...` | クライアントに露出してOK |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJ...` | **絶対に NEXT_PUBLIC_ を付けない**。サーバ専用 |
| `CRON_SECRET` | （任意）`openssl rand -base64 32` で生成 | Vercel Cron を使う時だけ |

> `SUPABASE_SERVICE_ROLE_KEY` は **RLS をバイパスする全権キー**です。`NEXT_PUBLIC_` プレフィックスを付けるとブラウザ側にバンドルされ、誰でも全データを読み書きできてしまいます。プレフィックスは絶対に付けない、Git にコミットしない、ログに出さない。

#### 4-3. デプロイ実行

1. `Deploy` ボタンを押す → ビルドが始まる（2〜3 分）。
2. 成功すると `https://<your-app>.vercel.app` の URL が発行される。
3. その URL を開くと `/login` に飛ぶ → Magic Link でログインしてみる。

`Build failed` になったら:
- `Build Logs` を最後まで読む。`Cannot find module` 系なら `package-lock.json` のコミット忘れ、`Type error` なら `npm run typecheck` をローカルで通す。
- 環境変数の typo（`NEXT_PUBLIC_SUPABASE_URL` を `NEXT_PUBLIC_SUPBASE_URL` にしているなど）も build/runtime で落ちる原因。

#### 4-4. Supabase の Site URL / Redirect URLs を本番 URL に更新

これを忘れると **Magic Link メールのリンクが本番ドメインに飛ばない / `redirect_uri` mismatch エラー** で詰まります。

1. Supabase ダッシュボード → `Authentication → URL Configuration`
2. **Site URL** を `https://<your-app>.vercel.app`（または独自ドメイン）に変更
3. **Redirect URLs** に以下を **すべて** 追加:
   - `https://<your-app>.vercel.app/auth/callback` ← 本番
   - `https://<your-app>-*-<team>.vercel.app/auth/callback` ← Preview デプロイ用ワイルドカード（必要なら）
   - `http://localhost:3000/auth/callback` ← ローカル開発用（残しておく）

#### 4-5. Google OAuth を有効化したい場合

Magic Link だけでよければ飛ばしてOK。Google ボタンも使いたい場合:

1. Google Cloud Console で OAuth クライアントを作成（Web application）
2. `Authorized redirect URIs` に `https://<your-supabase-project>.supabase.co/auth/v1/callback` を追加（**Vercel の URL ではない、Supabase の URL**）
3. Client ID / Client Secret を Supabase ダッシュボード → `Authentication → Providers → Google` に貼り付けて有効化

詳細手順: <https://supabase.com/docs/guides/auth/social-login/auth-google>

#### 4-6. （任意）独自ドメインの設定

1. Vercel → `Project → Settings → Domains` でドメインを追加
2. ドメインレジストラで CNAME / A レコードを Vercel が指示する値に設定（伝播 1〜30 分）
3. 反映後、Supabase の Site URL / Redirect URLs も新しいドメインに更新（4-4 と同じ手順）

#### 4-7. （任意）Vercel Cron で固定費 catch-up を毎日実行

`vercel.json` に Cron 定義が入っているはずです。Vercel ダッシュボード → `Project → Settings → Cron Jobs` で `/api/cron/fixed-costs-catchup` が登録されていることを確認。`CRON_SECRET` を環境変数に入れていれば、Vercel が自動で `Authorization: Bearer <secret>` を付けて呼んでくれます。

#### 4-8. デプロイ後の動作チェックリスト

- [ ] `/login` で Magic Link を送って自分のメアドにメールが来る
- [ ] メールのリンクが本番 URL（`https://<your-app>.vercel.app/auth/callback?...`）になっている
- [ ] リンクをクリックするとホーム画面に着地する
- [ ] 取引を 1 件追加 → リロードしても残っている
- [ ] 別アカウントで世帯を作ってデータが完全分離されている
- [ ] 設定 → 世帯タブで招待リンクを発行 → 別端末・別メアドで参加できる

---

## 既存環境からのアップグレード（旧シングルテナント版を使っていた人向け）

旧シングル世帯設計のデータを引き継ぎたい場合:

1. 上記の `0010_multi_tenant.sql` → `0011_seed_default_household.sql` を実行すると、既存データが「我が家」という名前の 1 世帯に紐づきます。
2. `0012_rls.sql` を実行（RLS 有効化）。
3. アプリで `/signup` から自分のメールでサインアップし、新世帯を作成 ← **ここで `auth.users` に新しい行ができる**
4. ただし新世帯は空。既存データを引き継ぐには Supabase SQL Editor で次を実行:

```sql
-- 1) 既存の「我が家」世帯 ID を確認
select id, name from households order by created_at;

-- 2) サインアップで作った auth user の ID を確認
select id, email from auth.users;

-- 3) 既存世帯のオーナーとして自分を追加
insert into household_members (household_id, auth_user_id, role)
values ('<our-household-id>', '<your-auth-user-id>', 'owner');

-- 4) サインアップで自動作成された「空の世帯」は不要なら削除
-- delete from households where id = '<the-empty-one-created-by-signup>';
```

これで既存の取引・カテゴリ・固定費すべてがあなたのアカウントから見えるようになります。
配偶者にも同じ手順（`/signup` → SQL で `household_members` に追加）を繰り返せば共有完了。

---

## 主な機能

### 世帯管理
- メール Magic Link / Google OAuth でログイン
- 自分が所属する世帯一覧と切り替え（複数世帯に所属可能）
- メンバーの招待（owner / editor / viewer ロール）

### 家計入力
- 3ステップ入力フォーム（支払い者 → 金額 → 項目）
- 共同変動費の予算プログレスバー（80%で「注意」、100%超で「超過」）
- 立替フローと精算
- グループ請求の分割記録（家計分 + 立替分）

### レポート / ダッシュボード
- 月次レポート（共同 / 特別 / 個人内訳）
- 全期間ダッシュボード（収支推移、カテゴリ別、予算達成率ヒートマップ）
- 60日キャッシュフロー予測

### 投資管理
- 口座 / 保有銘柄 / 売買履歴
- 売買時に `transactions` 側にも自動記録（買い=支出 / 売り=収入）
- 為替レート加重平均で JPY 換算

### 固定費の自動月次適用
- ホーム初回アクセス時に当月の固定費が `transactions` に自動投入
- `valid_from` で履歴管理（金額変更は新レコード追加 → 過去月に影響しない）

---

## Row-Level Security の仕組み

- `current_household_ids()` という SQL 関数が `auth.uid()` から所属世帯の集合を返す
- 全データテーブルに `for all using (household_id in (select current_household_ids()))` ポリシー
- → ログイン中のユーザーは自分の世帯のデータしか SELECT/INSERT/UPDATE/DELETE できない
- アプリのキャッシュ層は service-role キー + 明示的な `household_id` WHERE で同等の絞り込みを実装

別アカウントを作って動作確認しておくのを推奨。

---

## ロードマップ

- 旧 [docs/commercialization/roadmap.md](docs/commercialization/roadmap.md) は「商用化前提」のフルプラン。Phase 1 は本リポジトリで OSS として実装済み。
- 今後の方針（商用化前にまず OSS として磨き上げる）:
  - 招待リンクのメール自動送信（現在は手動コピー）
  - ハードコード除去 + i18n（多言語化）
  - 観測性 + DSAR (データエクスポート / 削除 API)
  - 銀行連携 / OCR / ネイティブアプリ化

競合品質に近づいたタイミングでアプリストア公開を再検討する想定です。

---

## 開発コマンド

```bash
npm run dev         # 開発サーバー
npm run build       # 本番ビルド
npm run typecheck   # TypeScript 型チェック
npm run lint        # ESLint
```

## ライセンス

MIT
