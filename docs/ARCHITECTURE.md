# アーキテクチャと実装契約

このリポジトリは「データ（YAML / Markdown）を単一の信頼できる情報源とし、
可視化物（HTML サイト・PROFILE.md）はすべて生成する」という方針で作られている。

```
data/*.yaml ─┐
blog/posts/  ├─► src/schema (検証) ─► src/lib (モデル+集計) ─► src/render (出力) ─► dist/, PROFILE.md
             ┘
```

## レイヤの責務

| レイヤ | ディレクトリ | 責務 | 禁止事項 |
|---|---|---|---|
| データ | `data/`, `blog/` | 事実のみを持つ | 書式・集計ロジックを持たない |
| スキーマ | `src/schema/` | zod による構造検証 | I/O・集計をしない |
| モデル | `src/lib/` | 読み込み＋集計（純粋関数中心） | HTML 文字列を作らない |
| レンダラ | `src/render/` | HTML / Markdown 生成 | ファイル I/O をしない（戻り値は文字列） |
| コマンド | `src/commands/` | I/O とオーケストレーション | 集計ロジックを持たない |

## 共通モジュール（変更前に相談が必要な共有基盤）

- `src/lib/paths.ts` — 全パス定義。ファイル位置はここから取得する。
- `src/lib/io.ts` — `readYaml(path, schema)` / `writeOut(path, text)` / `listFiles(dir, ext)`
- `src/lib/errors.ts` — `GrowthError(message, details[])`。利用者向けエラーはこれを投げる。
- `src/lib/date.ts` — `toJstDate` / `toJstTimestamp` / `daysBetween`
- `src/lib/consistency.ts` — スキル ID の横断参照検証
- `src/schema/common.ts` — `isoDate` / `quarter` / `skillLevel` (0-5) / `link` / `levelsFile`
- `src/render/layout.ts` — `layout({title, base, active, body, generatedAt})` / `escapeHtml(value)`
- `assets/style.css` — 共通スタイル。**レンダラは既存クラスのみを使う**（新規クラスが必要なら追記して理由をコメントする）。

利用可能なクラス: `.wrap .lead .card-grid .card .metric .metric-value .metric-label
.table-scroll table.table .level-chip[data-level] .badge .badge--done .badge--active
.badge--risk .badge--warn .tag .bar .bar-fill .timeline .timeline-item .timeline-item__date
.chart .chart-caption .post-list .post-item .post-meta .prose .empty`

## 各領域が実装するインターフェース（`src/commands/build.ts` が呼ぶ）

すべての領域が同じ形をとる。`X` は `skills` / `goals` / `roadmap` / `blog`。

```ts
// src/lib/<X>.ts
export interface XModel {
  /* 検証済みデータ + 集計結果 */
  referencedSkillIds: ReadonlyArray<{ id: string; source: string }>; // skills 以外
}
/**
 * 基準日は必ず引数で受け取る（デフォルト引数つき）。
 * 各モデルが内部で new Date() を呼ぶとビルドが非決定的になるため、
 * build / validate は ctx.now を 1 つだけ作って 4 領域すべてに渡す。
 */
export async function loadXModel(now?: Date): Promise<XModel>;

// src/render/<X>.ts
export function renderXPage(model: XModel, generatedAt: string): string;   // 完全な HTML
export function renderXMarkdown(model: XModel): string;                    // '## ' 見出しから始まる節
export function renderXCard(model: XModel): string;                        // <section class="card">…</section>
```

各モデルが追加で公開するもの:

| モデル | 追加のフィールド |
|---|---|
| `skills` | `ids`（全スキル ID）, `stats.averageLevel`, `warnings` |
| `goals` | `goals`, `ids`（全目標 ID）, `stale`, `stats.overallProgress`（= `stats.focus.progress`）, `stats.focus` / `stats.all` |
| `roadmap` | `milestones`, `referencedGoalIds`, `stats.completion`（`done/total`）, `stats.overdue` |
| `blog` | `posts`, `drafts`, `stats.freshness` |

**集計スコープは型で区別する。** `goals` の達成率は「現四半期・取りやめを除く」分母、
件数は「全四半期・全 status」。同じ行に並べる場合は、どちらのスコープかを必ず表示に書く
（混ぜると「5 件中 1 件達成で 66%」という読み違いが起きる）。

ブログのみ記事ごとのページがあるため、追加で以下を公開する。
Markdown から HTML への変換はここで行う（`src/lib/blog.ts` は Markdown のまま保持する）。

```ts
export function renderBlogPostPages(model: BlogModel, generatedAt: string): Array<{ fileName: string; html: string }>;
```

## ゲーム要素のレイヤ

ゲーム要素（XP・レベル・実績・クエスト・履歴）は 5 番目の領域として同じ規則に従う。
ただし**他の 4 領域から導出される**ため、ファイルを読むのは `data/history.yaml` だけ。

```
src/lib/game-types.ts   型の契約（実行時の依存を持たない）
src/lib/xp.ts           XP とレベルの計算（docs/GAME_DESIGN.md が規則の正）
src/lib/streaks.ts      連続記録の判定
src/lib/achievements.ts 実績の定義（条件はロジックなのでコードに置く）と評価
src/lib/quests.ts       次の一手の生成
src/lib/history.ts      data/history.yaml の読み書きと差分計算
src/lib/game.ts         上記を束ねて GameModel を作る
src/render/game.ts      game.html / PROFILE.md の「成長」節 / ダッシュボードのヒーロー
```

`loadGameModel({ skills, goals, roadmap, blog, now })` は 4 領域のモデルを
**引数で受け取る**（自分で読み直さない）。build と validate が同じモデルを使い回せる。

現在値のスナップショットは `history.ts` の `buildSnapshot` が唯一の組み立て場所。
画面に出す値と `data/history.yaml` に積む値を別々に組むと、同じ日なのに食い違う。

## 参照整合性

ファイルをまたぐ ID 参照は lib では検証せず、`src/commands/{build,validate}.ts` が
モデルを集めた後にまとめて検証する（`loadXModel` は自領域のファイルだけを読む）。

```ts
assertSkillReferences(skills.ids, [goals, roadmap, blog]);  // src/lib/consistency.ts
assertGoalReferences(goals.ids, [roadmap]);                 // src/lib/roadmap.ts
```

lib の中で他領域の `loadYModel()` を呼ぶと、同じファイルが二重にパースされ、
`Promise.all` が最初のエラーしか報告しないため原因の切り分けが遅くなる。

## 原則

- **エスケープ必須**: データ由来の文字列を HTML に埋める際は必ず `escapeHtml` を通す。
  例外は Markdown 本文を `marked` で変換した結果のみ（自分が書いた信頼済みコンテンツ）。
- **外部依存は追加しない**: 使えるのは `yaml` / `zod` / `marked` のみ。チャートは手書き SVG。
- **テストは振る舞いを検証**: 集計関数とスキーマの異常系を `tests/*.test.ts` に置く。
  テストデータはフィクスチャ（`tests/fixtures/`）を使い、`data/` の実データに依存させない。
- **生成物を手で編集しない**: `dist/` と `PROFILE.md` は `pnpm build` の出力。
- **`PROFILE.md` は決定的に生成する**: データが変わらなければ再ビルドで差分が出てはいけない。
  時刻などビルドごとに変わる値を入れると、週次の自動更新が無意味なコミットを積む
  （生成時刻は `dist/` のフッタだけに出す）。
- **閾値の判断は lib に置く**: 「古い」「遅延」「要注意」を決めるのは集計の仕事で、
  レンダラは結果をバッジに写すだけにする。
