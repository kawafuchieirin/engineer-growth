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
| 熱中する仕組み | 上記すべて（XP は自動算出） | レベル・実績バッジ・クエスト・成長グラフ |
| まとめ | 上記すべて | `PROFILE.md` と GitHub Pages のダッシュボード |

## 伸びているのが見える仕組み

成長していること自体が報酬になるように、ゲーム要素を入れている。

- **レベルと XP** — スキル・KR の進捗・完了ステップ・記事から自動算出する。
  `data/` を更新すると勝手に増える。**XP を直接書く場所は作っていない**ので、
  数字をいじって気分を良くすることはできない（増やす方法は実際に伸ばすことだけ）
- **成長の差分** — 「前回の記録から +299 XP」「90 日で平均レベル +0.30」のように、
  伸びを数字で見せる。これが見たいので記録を取る動機になる
- **実績バッジ 23 種** — 条件を満たすと自動で解放される。未解放のものも
  「あと 1 スキル」「2.65 / 3.00」と進捗付きで見えるので、次の目標になる
- **今日のクエスト** — 次の一手を最大 5 件、**なぜ今それなのか**と増える XP 付きで提示する
- **ストリーク** — 連続投稿週・連続棚卸し四半期。途切れそうなときは警告が出る
- **レベルアップのお祝い** — Actions がレベルの上昇を検知して Issue を立てる

計算規則は [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md)、実績の一覧は
[docs/ACHIEVEMENTS.md](docs/ACHIEVEMENTS.md) にある。

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

# 今の成長を記録する（これを積むと「伸びた」が見えるようになる）
pnpm growth snapshot
pnpm growth snapshot --dry-run

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
毎週  … ブログ or 学びのメモを 1 本（new-post）。連続投稿が途切れない
        （Actions が日曜 21:00 に snapshot を自動記録する）
毎月  … roadmap.yaml のマイルストーン進捗と steps を更新
四半期… skills.yaml を棚卸し → goals.yaml の KR 実績と振り返りを記入 → 次期 OKR を策定
        （Actions が四半期ごとにリマインド Issue を自動作成する）
```

記録は週次で自動化されているが、**レベルが上がりそうなときは手で
`pnpm growth snapshot` を叩いた方が気持ちがいい**ので、好きなときに実行してよい
（同じ日の記録は上書きされるので履歴は膨らまない）。

## ディレクトリ

```
data/           スキル・目標・ロードマップ・レベル定義（単一の信頼できる情報源）
data/history.yaml  成長の記録（append-only。過去を書き換えると伸びが嘘になる）
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
- [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md) — XP・レベル・クエストの計算規則
- [docs/ACHIEVEMENTS.md](docs/ACHIEVEMENTS.md) — 実績の一覧と追加の指針
- [docs/AUTOMATION.md](docs/AUTOMATION.md) — GitHub Actions と初期設定

## 注意

`dist/` と `PROFILE.md` は `pnpm build` の出力なので**手で編集しない**。
内容を変えたいときは `data/` か `blog/` を直す。
