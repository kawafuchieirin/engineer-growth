import { marked } from 'marked';
import type { BlogFreshness, BlogModel, BlogPost, BlogStats } from '../lib/blog.ts';
import { escapeHtml, layout } from './layout.ts';

/** 鮮度をバッジの見た目に写すだけの対応表。閾値の判断は lib/blog.ts が持つ。 */
const FRESHNESS_VARIANT: Record<Exclude<BlogFreshness, 'none'>, string> = {
  fresh: 'badge--done',
  stale: 'badge--warn',
  'very-stale': 'badge--risk',
};

/** 最終投稿からの経過日数を示すバッジ。公開記事が無い場合は null。 */
function staleBadge(stats: BlogStats): string | null {
  if (stats.freshness === 'none') return null;
  return `<span class="badge ${FRESHNESS_VARIANT[stats.freshness]}">最終投稿から ${stats.daysSinceLastPost} 日</span>`;
}

function renderTags(tags: ReadonlyArray<string>): string {
  return tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('');
}

/** 記事 1 件のメタ情報（日付・読了時間・スキル）。 */
function renderPostMeta(post: BlogPost): string {
  const parts = [
    `<time datetime="${escapeHtml(post.date)}">${escapeHtml(post.date)}</time>`,
    `約 ${post.readingMinutes} 分`,
    `スキル: ${post.skills.map((id) => escapeHtml(id)).join(', ')}`,
  ];
  return `<p class="post-meta">${parts.join(' ・ ')}</p>`;
}

/** 一覧用の記事カード。href は blog/ ディレクトリ内の相対パス。 */
function renderPostItem(post: BlogPost): string {
  return `    <li class="post-item">
      <h3><a href="${escapeHtml(post.fileName)}">${escapeHtml(post.title)}</a></h3>
      ${renderPostMeta(post)}
      <p>${escapeHtml(post.summary)}</p>
      <p>${renderTags(post.tags)}</p>
    </li>`;
}

/** 月別投稿数の棒グラフ。width はデータ由来なので inline style でしか表現できない。 */
function renderPaceTable(model: BlogModel): string {
  const monthly = model.stats.monthly;
  const max = Math.max(1, ...monthly.map((entry) => entry.count));
  const rows = monthly
    .map(
      (entry) => `        <tr>
          <th scope="row">${escapeHtml(entry.month)}</th>
          <td><span class="bar"><span class="bar-fill" style="width: ${Math.round((entry.count / max) * 100)}%"></span></span></td>
          <td>${entry.count} 件</td>
        </tr>`,
    )
    .join('\n');

  return `  <div class="table-scroll">
    <table class="table">
      <caption class="chart-caption">直近 12 か月の月別投稿数</caption>
      <thead><tr><th scope="col">月</th><th scope="col">ペース</th><th scope="col">本数</th></tr></thead>
      <tbody>
${rows}
      </tbody>
    </table>
  </div>`;
}

function renderStatsCards(model: BlogModel): string {
  const { stats } = model;
  const metrics: Array<{ value: string; label: string }> = [
    { value: String(stats.totalPosts), label: '公開記事' },
    { value: String(stats.postsLast90Days), label: '直近 90 日の投稿' },
    { value: stats.daysSinceLastPost === null ? '—' : String(stats.daysSinceLastPost), label: '最終投稿からの日数' },
    { value: String(stats.draftCount), label: '下書き' },
  ];

  return `  <div class="card-grid">
${metrics
  .map(
    (metric) => `    <section class="card">
      <div class="metric"><span class="metric-value">${escapeHtml(metric.value)}</span><span class="metric-label">${escapeHtml(metric.label)}</span></div>
    </section>`,
  )
  .join('\n')}
  </div>`;
}

export function renderBlogIndexPage(model: BlogModel, generatedAt: string): string {
  const sections: string[] = [
    '  <h1>ブログ</h1>',
    '  <p class="lead">学んだこと・詰まったこと・解決の道筋を記事として残し、スキルの裏付けにする。</p>',
    renderStatsCards(model),
  ];

  if (model.posts.length === 0) {
    sections.push(
      `  <p class="empty">公開記事がまだありません。<code>pnpm growth new-post "記事タイトル" --slug my-slug</code> で雛形を作り、最初の 1 本を書きましょう。${
        model.stats.draftCount > 0 ? `（下書き ${model.stats.draftCount} 件が眠っています）` : ''
      }</p>`,
    );
  } else {
    const badge = staleBadge(model.stats);
    sections.push(
      '  <h2>投稿ペース</h2>',
      `  <p class="post-meta">${
        badge ?? ''
      } 最終投稿: ${escapeHtml(model.stats.lastPostDate ?? '—')}</p>`,
      renderPaceTable(model),
      '  <h2>タグ</h2>',
      `  <p>${model.tags
        .map(
          (entry) =>
            `<span class="tag">${escapeHtml(entry.tag)} ${entry.count}</span>`,
        )
        .join('')}</p>`,
      '  <h2>記事一覧</h2>',
      `  <ul class="post-list">
${model.posts.map(renderPostItem).join('\n')}
  </ul>`,
    );
  }

  return layout({
    title: 'ブログ | Engineer Growth',
    // blog/index.html はサブディレクトリなのでサイトルートは 1 つ上。
    base: '../',
    active: 'blog',
    generatedAt,
    body: sections.join('\n'),
  });
}

/** 前後の記事と一覧へのナビゲーション。posts は日付降順なので index+1 が「古い記事」。 */
function renderPostNav(posts: ReadonlyArray<BlogPost>, index: number): string {
  const newer = posts[index - 1];
  const older = posts[index + 1];
  const items = [
    older ? `<a href="${escapeHtml(older.fileName)}">← 古い記事: ${escapeHtml(older.title)}</a>` : null,
    `<a href="index.html">記事一覧</a>`,
    newer ? `<a href="${escapeHtml(newer.fileName)}">新しい記事: ${escapeHtml(newer.title)} →</a>` : null,
  ].filter((item): item is string => item !== null);

  return `  <nav class="post-meta" aria-label="記事ナビゲーション">${items.join(' ・ ')}</nav>`;
}

function renderLinks(post: BlogPost): string {
  if (post.links.length === 0) return '';
  return `  <h2>参考</h2>
  <ul>
${post.links
  .map(
    (ref) =>
      `    <li><a href="${escapeHtml(ref.url)}" rel="noreferrer noopener">${escapeHtml(ref.label)}</a></li>`,
  )
  .join('\n')}
  </ul>`;
}

export function renderBlogPostPages(
  model: BlogModel,
  generatedAt: string,
): Array<{ fileName: string; html: string }> {
  return model.posts.map((post, index) => ({
    fileName: post.fileName,
    html: layout({
      title: `${post.title} | Engineer Growth`,
      base: '../',
      active: 'blog',
      generatedAt,
      body: [
        `  <h1>${escapeHtml(post.title)}</h1>`,
        `  ${renderPostMeta(post)}`,
        `  <p class="lead">${escapeHtml(post.summary)}</p>`,
        `  <p>${renderTags(post.tags)}</p>`,
        // 本文はこのリポジトリで自分が書いた信頼済み Markdown なので、marked の出力を
        // エスケープせずそのまま埋め込む（外部入力ではないという前提での例外）。
        // front matter 由来の文字列は外から来うるので従来どおり escapeHtml する。
        // 変換をここで行うのは、HTML 生成がレンダラの責務であり、かつ
        // サイトに出力しない下書きまで変換するのは無駄だから。
        `  <article class="prose">\n${marked.parse(post.markdown, { async: false }).trim()}\n  </article>`,
        renderLinks(post),
        renderPostNav(model.posts, index),
      ]
        .filter((part) => part !== '')
        .join('\n'),
    }),
  }));
}

/**
 * Markdown のテーブルセルを壊さないようにする（| と改行を無害化）。
 * front matter の複数行文字列でタイトルやタグに改行が入りうるため、
 * skills 側の mdCell と同じ扱いに揃えている。
 */
function cell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

export function renderBlogMarkdown(model: BlogModel): string {
  const lines: string[] = ['## ブログ', ''];

  if (model.posts.length === 0) {
    lines.push(
      `公開記事はまだありません（下書き ${model.stats.draftCount} 件）。`,
      '',
      '`pnpm growth new-post "記事タイトル" --slug my-slug` で 1 本目を書き始められます。',
    );
    return lines.join('\n');
  }

  const { stats } = model;
  lines.push(
    `公開 ${stats.totalPosts} 件 / 直近 90 日 ${stats.postsLast90Days} 件 / 下書き ${stats.draftCount} 件 / ` +
      `最終投稿 ${stats.lastPostDate}（${stats.daysSinceLastPost} 日前）`,
    '',
    '### 最近の記事',
    '',
    '| 日付 | タイトル | タグ | 読了 |',
    '|---|---|---|---|',
    ...model.posts
      .slice(0, 5)
      .map(
        (post) =>
          // PROFILE.md はリポジトリルートに置かれるので、記事のソース Markdown を直接指す。
          `| ${post.date} | [${cell(post.title)}](${post.sourcePath}) | ${cell(
            post.tags.join(', '),
          )} | 約 ${post.readingMinutes} 分 |`,
      ),
    '',
    '### よく書いているテーマ',
    '',
    model.tags
      .slice(0, 8)
      .map((entry) => `${entry.tag} (${entry.count})`)
      .join(' / '),
  );

  return lines.join('\n');
}

export function renderBlogCard(model: BlogModel): string {
  const { stats } = model;
  const badge = staleBadge(stats);

  const recent =
    model.posts.length === 0
      ? '      <p class="empty">記事がまだありません。最初の 1 本を書きましょう。</p>'
      : `      <ul>
${model.posts
  .slice(0, 3)
  .map(
    (post) =>
      `        <li><a href="blog/${escapeHtml(post.fileName)}">${escapeHtml(post.title)}</a></li>`,
  )
  .join('\n')}
      </ul>`;

  return `    <section class="card">
      <h2><a href="blog/index.html">ブログ</a></h2>
      <div class="metric"><span class="metric-value">${stats.totalPosts}</span><span class="metric-label">公開記事</span></div>
      <p class="post-meta">直近 90 日 ${stats.postsLast90Days} 件 ・ 下書き ${stats.draftCount} 件</p>
      <p>${badge ?? '<span class="badge">未投稿</span>'}</p>
${recent}
    </section>`;
}
