# engineer-growth

エンジニアとしての**スキルの現在地・目標・ロードマップ・アウトプット**を一つのリポジトリで管理し、
可視化物を自動生成するための個人用リポジトリ。

> 考え方: 事実は YAML と Markdown にだけ書く。グラフ・サマリ・プロファイルは**すべて生成物**。
> 人間は「現在地」と「行きたい場所」の更新だけに集中する。

## できること

| やりたいこと | 実体 | 生成されるもの |
|---|---|---|
| 自己能力の可視化 | `data/skills.yaml`（0-5 のレベル + 根拠） | レーダーチャート、カテゴリ別平均、ギャップ一覧 |
| 目標策定 | `data/goals.yaml`（四半期 OKR） | 進捗バー、KR 実績、at-risk 警告 |
| ロードマップ作成 | `data/roadmap.yaml`（マイルストーン） | ガントチャート、タイムライン、遅延検出 |
| ブログの執筆 | `blog/posts/*.md` | 記事ページ、一覧、投稿ペースの統計 |
| まとめ | 上記すべて | `PROFILE.md` と GitHub Pages のダッシュボード |

## セットアップ

```bash
mise trust && mise install   # Node 24（.mise.toml で固定）
pnpm install
pnpm verify                      # typecheck → test → build
```

## 日々の使い方

```bash
# 検証（スキーマ + スキル ID の参照整合性）
pnpm validate

# 可視化物を生成（dist/ と PROFILE.md）
pnpm build
open dist/index.html

# スキル棚卸しをターミナルで確認
pnpm growth skills-report
pnpm growth skills-report --gaps

# ブログ記事を新規作成
pnpm growth new-post "Terraform の state を壊した話" --slug terraform-state-recovery --skills infra-terraform

# 使えるコマンド一覧
pnpm growth --help
```

## 運用サイクル

```
毎週  … ブログ or 学びのメモを 1 本（new-post）
毎月  … roadmap.yaml のマイルストーン進捗と steps を更新
四半期… skills.yaml を棚卸し → goals.yaml の KR 実績と振り返りを記入 → 次期 OKR を策定
        （Actions が四半期ごとにリマインド Issue を自動作成する）
```

## ディレクトリ

```
data/           スキル・目標・ロードマップ・レベル定義（単一の信頼できる情報源）
blog/posts/     公開記事   blog/drafts/  下書き
src/schema/     zod による検証      src/lib/     読み込みと集計
src/render/     HTML / Markdown 生成  src/commands/  CLI
assets/         生成サイトのスタイルシート
templates/      記事・四半期振り返りの雛形
tests/          振る舞いのテスト（vitest）
docs/           運用ガイド
dist/           生成物（Git 管理外）    PROFILE.md  生成物（コミット対象）
```

## ドキュメント

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — 構成とレイヤの実装契約
- [docs/SKILLS_GUIDE.md](docs/SKILLS_GUIDE.md) — 自己評価の付け方、レベルの定義
- [docs/GOALS_GUIDE.md](docs/GOALS_GUIDE.md) — OKR の立て方と回し方
- [docs/ROADMAP_GUIDE.md](docs/ROADMAP_GUIDE.md) — マイルストーンの切り方
- [docs/BLOG_GUIDE.md](docs/BLOG_GUIDE.md) — 記事の書き方と front matter
- [docs/AUTOMATION.md](docs/AUTOMATION.md) — GitHub Actions と初期設定

## 注意

`dist/` と `PROFILE.md` は `pnpm build` の出力なので**手で編集しない**。
内容を変えたいときは `data/` か `blog/` を直す。
