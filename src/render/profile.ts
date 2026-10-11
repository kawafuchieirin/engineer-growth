export interface ProfileInput {
  /**
   * JST の生成日（YYYY-MM-DD）。
   *
   * 分単位の時刻を書かないのは、PROFILE.md がコミット対象の生成物だから。
   * 時刻を入れるとデータを 1 文字も変えていなくてもビルドごとに差分が出て、
   * .github/workflows/profile.yml の週次実行が毎週無意味なコミットを積む。
   * 生成時刻を知りたい場面は dist/ のフッタが担う。
   */
  generatedOn: string;
  /** 各領域が生成した Markdown セクション（`## ` 見出しから始まる）。 */
  sections: string[];
}

/**
 * PROFILE.md を組み立てる。中身は生成物なので手で編集せず、
 * data/ と blog/ を更新して `pnpm build` を実行する。
 */
export function renderProfileMarkdown({ generatedOn, sections }: ProfileInput): string {
  return [
    '<!-- このファイルは `pnpm build` による生成物です。直接編集しないでください。 -->',
    '',
    '# エンジニア成長プロファイル',
    '',
    `最終更新: ${generatedOn}`,
    '',
    ...sections.flatMap((section) => [section.trim(), '']),
  ]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd();
}
