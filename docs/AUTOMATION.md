# 自動化（GitHub Actions）とリポジトリ初期設定

このリポジトリは `data/*.yaml` と `blog/posts/*.md` を単一の情報源とし、
サイト（`dist/`）と `PROFILE.md` を生成する。
生成物が手作業に依存すると必ずずれるので、検証・公開・生成物の更新・振り返りの催促は
すべて GitHub Actions に寄せている。

## ワークフロー一覧

| ファイル | 役割 | トリガー | 権限 |
|---|---|---|---|
| `.github/workflows/ci.yml` | 型チェック・テスト・データ検証・ビルドの検証 | `push`(main) / `pull_request` / 手動 | `contents: read` |
| `.github/workflows/pages.yml` | `dist/` を GitHub Pages に公開 | `push`(main の `data/** blog/** src/** assets/**`) / 手動 | build: `contents: read`<br>deploy: `pages: write`, `id-token: write` |
| `.github/workflows/profile.yml` | `PROFILE.md` を再生成してコミット | `push`(main の `data/** blog/**`) / 週次 `0 23 * * 0` / 手動 | `contents: write` |
| `.github/workflows/growth-review.yml` | 四半期の振り返り Issue を作成 | 四半期初日 `0 0 1 1,4,7,10 *` / 手動 | `issues: write` |

いずれもワークフロー全体とジョブの両方で `permissions` を明示している（最小権限）。
`permissions` を 1 つでも書くと未指定のスコープは `none` になるため、
書いていないスコープ（例: `packages`、`actions`）は一切使えない。

### スケジュールの JST 換算

`cron` は UTC 指定なので、JST（UTC+9）に直して確認する。

| ワークフロー | cron (UTC) | JST | 意図 |
|---|---|---|---|
| `profile.yml` | `0 23 * * 0` | 毎週**月曜 08:00**（日曜 23:00 UTC + 9h = 月曜 08:00） | 週の頭にプロフィールを最新化する |
| `growth-review.yml` | `0 0 1 1,4,7,10 *` | 1/4/7/10 月の **1 日 09:00**（0:00 UTC + 9h = 同日 09:00） | 四半期の頭に振り返りを促す |

`growth-review.yml` は本来「第1営業日」に出したいが、cron に営業日・祝日の概念がないため
**1 日固定**で妥協している。1 日が休日なら、着手は次の営業日でよい（Issue は消えない）。

なお GitHub のスケジュール実行は混雑時に数十分遅れることがある。遅延は許容し、
厳密な時刻が必要な用途には使わない。

### 無限ループ対策（`profile.yml`）

`PROFILE.md` をコミットするワークフローは、自分の push で自分が再実行される危険がある。
三重に歯止めをかけている。

1. **パスフィルタ** — トリガーは `data/**` と `blog/**` のみ。このワークフローが変更するのは
   `PROFILE.md` だけなので、自分のコミットはフィルタに一致しない。
2. **`[skip ci]`** — コミット本文に付与し、パスフィルタを持たない `ci.yml` も再実行させない。
3. **`GITHUB_TOKEN` の仕様** — 既定のトークンによる push はワークフローを再発火しない。

また、差分が無ければコミットしない（`git status --porcelain -- PROFILE.md` で判定）ので、
空コミットが積み上がることもない。

## 初期設定（GitHub の画面で一度だけ行う作業）

### 1. GitHub Pages を有効化する

1. リポジトリの **Settings** → 左メニューの **Pages**
2. **Build and deployment** の **Source** を **GitHub Actions** に変更
3. `main` に push するか、**Actions** タブで `Pages` ワークフローを手動実行（`Run workflow`）
4. 完了後、`deploy` ジョブのサマリまたは Settings → Pages に公開 URL が表示される

`Source` が `Deploy from a branch` のままだと `actions/deploy-pages` が失敗する。

### 2. Actions の書き込み権限を確認する

1. **Settings** → **Actions** → **General**
2. **Workflow permissions** は **Read repository contents and packages permissions**（読み取りのみ）を推奨
3. そのままでよい。各ワークフローが必要なスコープ（`profile.yml` の `contents: write` など）を
   ファイル内で宣言しているため、既定を読み取りに絞っていても動く
   （この設定は「上限」ではなく「既定値」で、`permissions` キーで引き上げられる）

`main` にブランチ保護を掛ける場合は、`github-actions[bot]` の push を許可するか、
`profile.yml` の push 先を別ブランチ＋PR 運用に変える必要がある。

### 3. `growth-review` ラベルを用意する

ワークフローはラベルが無ければ自分で作成し、作成に失敗しても Issue 作成は続行する
（`core.warning` を出すだけ）。手で先に作るなら次のいずれか。

- 画面から: **Issues** → **Labels** → **New label** → 名前 `growth-review`、色 `#0e8a16`
- CLI から:

  ```sh
  gh label create growth-review --color 0e8a16 --description "四半期の振り返りと目標策定"
  ```

Issue テンプレートが使う `skill` / `goal` / `blog` ラベルと、Dependabot が使う
`dependencies` / `github-actions` ラベルも同様に、無ければ自動作成される。

### 4. Dependabot

`.github/dependabot.yml` を main に置いた時点で有効になる（画面操作は不要）。
`npm`（`pnpm-lock.yaml`）と `github-actions` を毎週月曜 09:00 JST に確認し、
マイナー・パッチは 1 本の PR にまとめ、コミットメッセージは `chore` プレフィックスになる。

## action のバージョン固定について

サードパーティの action（`jdx/mise-action` / `pnpm/action-setup`）は
**コミット SHA で固定**し、末尾のコメントに人間が読めるバージョンを書いている。

```yaml
uses: jdx/mise-action@2d8d4cafcbd33be2ea37d2b6f5ad595363d1f1ca # v5.1.1
```

タグは作者が後から付け替えられる。`contents: write` を持つ `profile.yml` や
`pages: write` を持つ `pages.yml` が、タグの付け替えで差し替わったコードを
実行すると、リポジトリへの書き込みや公開内容を奪われる。
SHA の更新は Dependabot（`github-actions` エコシステム）が PR で提案するので、
手で追う必要はない。

`actions/*` は GitHub 自身が管理しているためメジャータグ参照のままにしている。

あわせて、`actions/checkout` には `persist-credentials: false` を指定している。
既定では checkout がトークンを `.git/config` に残すため、後続のサードパーティ
action からも読めてしまう。push が必要な `profile.yml` では、最後の push ステップ
だけに `GH_TOKEN` を渡している。

## ローカルで同じ検証を回す

CI と同じ順序をローカルで再現できる。CI で落ちたらまずこれを実行する。

```sh
mise install                    # .mise.toml の Node 24 を用意
pnpm install --frozen-lockfile  # CI と同じ依存解決（ロックファイル固定）
pnpm typecheck                  # tsc --noEmit
pnpm test                       # vitest run
pnpm validate                   # スキーマ検証 + スキル ID の参照整合性
pnpm build                      # dist/ と PROFILE.md を生成
```

`pnpm verify` は `typecheck → test → validate → build` をまとめて実行する。
データだけを触ったときは `pnpm validate` を先に単体で回すのが速い。

## ワークフローが失敗したときの切り分け

まず **Actions** タブで失敗したジョブを開き、赤いステップ名を見る。
ステップ名は日本語で機能単位に分けてあるので、名前だけで原因の層が分かる。

| 失敗したステップ | 原因の層 | 対処 |
|---|---|---|
| 依存関係をインストール（ロックファイル固定） | `package.json` と `pnpm-lock.yaml` の不一致 | ローカルで `pnpm install` し、`pnpm-lock.yaml` をコミットする |
| 型チェック | `src/` の型エラー | `pnpm typecheck` を再現して直す |
| ユニットテスト | 振る舞いの退行 | `pnpm test` で失敗テストを特定する |
| データ検証 | `data/*.yaml` のスキーマ違反、スキル ID の参照切れ | エラーに出た ID を `data/skills.yaml` と照合する。既存 ID の改名・削除は参照を壊す |
| サイトと PROFILE.md のビルド | レンダラ側の例外 | 検証が通ってビルドだけ落ちる場合は `src/render/` を疑う |
| mise で Node をセットアップ | `.mise.toml` の記述、ネットワーク | ローカルで `mise install` が通るか確認する |

ワークフロー別の典型的な失敗。

- **`pages.yml` の deploy が失敗する** — Settings → Pages の Source が `GitHub Actions` か確認する。
  `environment: github-pages` に保護ルールが付いている場合は承認が必要。
- **`profile.yml` の push が失敗する** — `contents: write` が宣言されているので、
  残る原因はブランチ保護かリポジトリ設定。上記「2. Actions の書き込み権限」を確認する。
- **`profile.yml` が「差分はありません」で終わる** — 正常。`data/` の変更が
  `PROFILE.md` の出力に影響しなかっただけ。
- **振り返り Issue が作られない** — 同じ四半期の **未クローズ** Issue
  （タイトルに `[YYYY-QN]` を含むもの）があるとスキップする仕様。
  作り直したいときは既存 Issue を閉じてから手動実行する。
- **スケジュール実行が走らない** — 60 日以上コミットが無い個人リポジトリでは
  `schedule` が自動停止する。Actions タブから手動実行すれば再開する。

ローカルでワークフロー自体の構文を検証する場合は [actionlint](https://github.com/rhysd/actionlint) を使う。

```sh
mise x actionlint@latest -- actionlint
```
