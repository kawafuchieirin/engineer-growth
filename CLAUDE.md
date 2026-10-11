# engineer-growth のコーディング指針

個人の成長記録リポジトリ。グローバルの `~/.claude/CLAUDE.md` に加えて、以下を守る。

## このリポジトリの原則

1. **事実はデータに、書式はコードに。** `data/*.yaml` と `blog/posts/*.md` が唯一の情報源。
   HTML や Markdown サマリは生成物であり、手で編集しない（`dist/`, `PROFILE.md`）。
2. **レイヤを越えない。** schema は検証のみ、lib は集計のみ、render は文字列生成のみ、
   commands だけが I/O を行う。詳細と各領域の関数シグネチャは `docs/ARCHITECTURE.md`。
3. **依存を増やさない。** 使えるのは `yaml` / `zod` / `marked` のみ。
   チャートは手書きの inline SVG で描く（ビルドを軽く、サイトを単一ファイルで完結させる）。
4. **データの腐敗を放置しない。** 不正なデータは `GrowthError` で落とす。
   skip・デフォルト値での誤魔化し・`try-catch` での握りつぶしはしない。
5. **HTML 生成では必ず `escapeHtml` を通す。** 例外は自分が書いた Markdown 本文を
   `marked` で変換した結果のみ。
6. **XP を手で書ける場所を作らない。** XP・レベル・実績はすべて `data/` と `blog/` からの
   導出に限る。手入力の余地を作ると、伸びていないのに数字だけ増やせてしまい、
   この仕組みが自分を騙す道具になる。詳細は `docs/GAME_DESIGN.md`。
7. **`data/history.yaml` は append-only。** 過去のスナップショットを書き換えない。
   書き換えると「伸びた」が嘘になる。記録は `pnpm growth snapshot` だけが行う。

## テスト

- 集計ロジックは純粋関数として切り出し、インラインのフィクスチャで振る舞いを検証する。
- `data/` の実データに依存するテストを書かない（データ更新でテストが壊れるのを防ぐ）。
- 日付に依存するロジックは「今日」を引数で受け取り、決定的にする。

## 変更の進め方

- `src/lib/paths.ts` `src/lib/io.ts` `src/render/layout.ts` `assets/style.css` は共有基盤。
  変更は全領域に波及するので、影響範囲を確認してから触る。
- 新しい可視化を追加するときは `src/render/` に関数を足し、`src/commands/build.ts` から呼ぶ。
- データ構造を変えるときは schema → lib → render → テスト → ガイド（`docs/`）の順に更新する。

## 完了の定義

```bash
pnpm verify   # typecheck → test → build が通ること
```
