import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildBlogModel,
  computeFreshness,
  computeMonthlyCounts,
  computeStats,
  computeTagCounts,
  estimateReadingMinutes,
  loadPostsFromDir,
  parseFrontMatter,
  parsePost,
  sortByDateDesc,
  type BlogPost,
} from '../src/lib/blog.ts';
import { GrowthError } from '../src/lib/errors.ts';
import {
  renderBlogCard,
  renderBlogIndexPage,
  renderBlogMarkdown,
  renderBlogPostPages,
} from '../src/render/blog.ts';
import { fillTemplate, parseNewPostArgs, slugify } from '../src/commands/new-post.ts';

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const NOW = new Date('2026-05-01T12:00:00+09:00');

interface ArticleOverrides {
  title?: string;
  date?: string;
  tags?: string;
  skills?: string;
  summary?: string;
  status?: string;
  body?: string;
}

/** テスト用の記事テキスト。front matter の 1 項目だけを崩す検証がしやすい形にする。 */
function article(overrides: ArticleOverrides = {}): string {
  const {
    title = 'テスト記事',
    date = '2026-04-01',
    tags = '[terraform, aws]',
    skills = '[infra-terraform]',
    summary = 'テスト用の要約。十分な長さを持たせている。',
    status = 'published',
    body = '## 課題\n\n本文。',
  } = overrides;

  return `---\ntitle: ${title}\ndate: ${date}\ntags: ${tags}\nskills: ${skills}\nsummary: ${summary}\nstatus: ${status}\n---\n\n${body}\n`;
}

function post(overrides: ArticleOverrides & { fileName?: string; origin?: 'posts' | 'drafts' } = {}): BlogPost {
  const { fileName = '2026-04-01-test-post.md', origin = 'posts', ...rest } = overrides;
  return parsePost(article(rest), fileName, origin);
}

/**
 * 1 記事をレンダリングして記事ページの HTML を得る。
 * 本文の HTML 化はレンダラの責務なので、モデルの内部フィールドではなく
 * 「出力に何が含まれるか」で検証する。
 */
function renderedPostHtml(target: BlogPost): string {
  const [page] = renderBlogPostPages(buildBlogModel([target], NOW), '2026-05-01 12:00 (JST)');
  return page?.html ?? '';
}

describe('parseFrontMatter / parsePost の異常系', () => {
  it('front matter が無ければファイル名付きの GrowthError になる', () => {
    expect(() => parsePost('# 見出しだけの記事\n', '2026-04-01-no-front-matter.md', 'posts')).toThrowError(
      /front matter がありません: blog\/posts\/2026-04-01-no-front-matter\.md/,
    );
    expect(() => parsePost('本文のみ\n', '2026-04-01-no-front-matter.md', 'posts')).toThrowError(GrowthError);
  });

  it('front matter が閉じられていなければエラーになる', () => {
    const raw = '---\ntitle: 閉じ忘れ\ndate: 2026-04-01\n';
    expect(() => parsePost(raw, '2026-04-01-unclosed.md', 'posts')).toThrowError(
      /front matter が閉じられていません: blog\/posts\/2026-04-01-unclosed\.md/,
    );
  });

  it('YAML 構文エラーはファイル名と原因を添えて報告する', () => {
    const raw = '---\ntitle: [壊れた\ndate: 2026-04-01\n---\n\n本文\n';
    let thrown: unknown;
    try {
      parsePost(raw, '2026-04-01-broken-yaml.md', 'posts');
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(GrowthError);
    expect((thrown as GrowthError).message).toContain('blog/posts/2026-04-01-broken-yaml.md');
    expect((thrown as GrowthError).details.join('\n')).not.toBe('');
  });

  it('必須フィールドの欠落はどのフィールドが原因かを示す', () => {
    const raw = '---\ntitle: 要約なし\ndate: 2026-04-01\ntags: [aws]\nskills: [cloud-aws]\nstatus: published\n---\n\n本文\n';
    let thrown: unknown;
    try {
      parsePost(raw, '2026-04-01-missing-summary.md', 'posts');
    } catch (error) {
      thrown = error;
    }
    expect((thrown as GrowthError).message).toContain('blog/posts/2026-04-01-missing-summary.md');
    expect((thrown as GrowthError).details.join('\n')).toContain('summary');
  });

  it('要約が短すぎる・タグが kebab-case でない front matter を拒否する', () => {
    expect(() => post({ summary: '短い' })).toThrowError(GrowthError);
    expect(() => post({ tags: '[Terraform]' })).toThrowError(GrowthError);
    expect(() => post({ skills: '[]' })).toThrowError(GrowthError);
  });

  it('未知のフィールドを拒否する（タイポが黙って無視されない）', () => {
    const raw = article().replace('status: published', 'status: published\ntag: typo');
    expect(() => parsePost(raw, '2026-04-01-typo.md', 'posts')).toThrowError(GrowthError);
  });

  it('ファイル名の日付と front matter の date の不一致はエラーになる', () => {
    expect(() => post({ fileName: '2026-04-02-test-post.md', date: '2026-04-01' })).toThrowError(
      /ファイル名の日付と front matter の date が一致しません/,
    );
  });

  it('ファイル名が規約に合わなければエラーになる', () => {
    expect(() => post({ fileName: 'test-post.md' })).toThrowError(/ファイル名が規約に合っていません/);
    expect(() => post({ fileName: '2026-04-01-Test_Post.md' })).toThrowError(GrowthError);
  });

  it('ファイル名の slug とタイトルの不一致は許容する', () => {
    const parsed = post({ fileName: '2026-04-01-totally-different.md', title: '全く違うタイトル' });
    expect(parsed.slug).toBe('totally-different');
    expect(parsed.title).toBe('全く違うタイトル');
  });
});

describe('parseFrontMatter の正常系', () => {
  it('CRLF 改行の記事を正しくパースする', () => {
    const raw = article({ body: '## 課題\r\n\r\n本文。' }).replace(/\n/g, '\r\n');
    const parsed = parsePost(raw, '2026-04-01-crlf.md', 'posts');
    expect(parsed.title).toBe('テスト記事');
    expect(parsed.markdown).not.toContain('\r');
    expect(parsed.markdown).toContain('## 課題');
  });

  it('区切り行末尾の空白と BOM を許容する', () => {
    const raw = `﻿${article().replace(/^---$/m, '---  ')}`;
    expect(parsePost(raw, '2026-04-01-bom.md', 'posts').title).toBe('テスト記事');
  });

  it('front matter を本文に残さず、Markdown のまま保持する（HTML 化はレンダラの責務）', () => {
    const parsed = post({ body: '## 課題\n\n- 一つ目\n- 二つ目\n' });
    expect(parsed.markdown).toBe('## 課題\n\n- 一つ目\n- 二つ目');
    expect(parsed.markdown).not.toContain('title:');
    expect(parsed).not.toHaveProperty('html');
  });

  it('body が空でも落ちない（書き始めの記事）', () => {
    const parsed = parseFrontMatter(article({ body: '' }), 'blog/posts/x.md');
    expect(parsed.body).toBe('');
  });
});

describe('下書きの扱い', () => {
  it('status: draft と blog/drafts/ 配下の記事は posts に入らず drafts に入る', () => {
    const published = post({ fileName: '2026-04-03-published.md', date: '2026-04-03' });
    const statusDraft = post({ fileName: '2026-04-02-status-draft.md', date: '2026-04-02', status: 'draft' });
    const dirDraft = post({ fileName: '2026-04-01-dir-draft.md', date: '2026-04-01', origin: 'drafts' });

    const model = buildBlogModel([published, statusDraft, dirDraft], NOW);

    expect(model.posts.map((p) => p.fileName)).toEqual(['2026-04-03-published.html']);
    expect(model.drafts.map((p) => p.fileName)).toEqual([
      '2026-04-02-status-draft.html',
      '2026-04-01-dir-draft.html',
    ]);
    expect(model.stats.totalPosts).toBe(1);
    expect(model.stats.draftCount).toBe(2);
  });

  it('下書きのスキル ID も referencedSkillIds に含める（公開前に腐敗を検出するため）', () => {
    const model = buildBlogModel([post({ origin: 'drafts' })], NOW);
    expect(model.referencedSkillIds).toEqual([
      { id: 'infra-terraform', source: 'blog/drafts/2026-04-01-test-post.md' },
    ]);
  });
});

describe('未来日の記事', () => {
  it('未来日の公開記事はモデル構築時にエラーになる（予約投稿の仕組みは無い）', () => {
    // NOW = 2026-05-01。書き間違いを静かに丸めず、どのファイルが原因かを示す。
    const future = post({ fileName: '2026-05-04-future.md', date: '2026-05-04' });
    let thrown: unknown;
    try {
      buildBlogModel([future], NOW);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(GrowthError);
    expect((thrown as GrowthError).message).toContain('2026-05-01');
    expect((thrown as GrowthError).details.join('\n')).toContain(
      'blog/posts/2026-05-04-future.md: date 2026-05-04',
    );
  });

  it('基準日と同じ日付の公開記事は許容する（未来ではない）', () => {
    const today = post({ fileName: '2026-05-01-today.md', date: '2026-05-01' });
    const model = buildBlogModel([today], NOW);
    expect(model.stats.daysSinceLastPost).toBe(0);
    expect(model.stats.freshness).toBe('fresh');
  });

  it('未来日の下書きは許容する（執筆予定日として使えるため）', () => {
    const statusDraft = post({ fileName: '2026-05-04-plan.md', date: '2026-05-04', status: 'draft' });
    const dirDraft = post({ fileName: '2026-06-01-plan.md', date: '2026-06-01', origin: 'drafts' });
    const model = buildBlogModel([statusDraft, dirDraft], NOW);
    expect(model.stats.draftCount).toBe(2);
    expect(model.stats.daysSinceLastPost).toBeNull();
    expect(model.stats.freshness).toBe('none');
  });
});

describe('鮮度（freshness）', () => {
  it('経過日数の境界で鮮度が切り替わる', () => {
    expect(computeFreshness(null)).toBe('none');
    expect(computeFreshness(0)).toBe('fresh');
    expect(computeFreshness(30)).toBe('fresh');
    expect(computeFreshness(31)).toBe('stale');
    expect(computeFreshness(90)).toBe('stale');
    expect(computeFreshness(91)).toBe('very-stale');
  });

  it('stats の freshness が最終投稿日から決まる', () => {
    // 基準日 2026-05-01 からの経過日数: 30 / 31 / 90 / 91 日。
    const cases: Array<{ date: string; fileName: string; expected: string }> = [
      { date: '2026-04-01', fileName: '2026-04-01-a.md', expected: 'fresh' },
      { date: '2026-03-31', fileName: '2026-03-31-b.md', expected: 'stale' },
      { date: '2026-01-31', fileName: '2026-01-31-c.md', expected: 'stale' },
      { date: '2026-01-30', fileName: '2026-01-30-d.md', expected: 'very-stale' },
    ];
    for (const { date, fileName, expected } of cases) {
      expect(buildBlogModel([post({ date, fileName })], NOW).stats.freshness).toBe(expected);
    }
  });

  it('公開記事が無ければ freshness は none', () => {
    expect(computeStats([], [], '2026-05-01').freshness).toBe('none');
    expect(buildBlogModel([], NOW).stats.freshness).toBe('none');
  });
});

describe('集計', () => {
  const posts = [
    post({ fileName: '2026-01-10-a.md', date: '2026-01-10', tags: '[aws, terraform]' }),
    post({ fileName: '2026-04-20-b.md', date: '2026-04-20', tags: '[aws]' }),
    post({ fileName: '2026-02-15-c.md', date: '2026-02-15', tags: '[aws, docker]' }),
  ];

  it('記事は日付降順に並ぶ', () => {
    expect(sortByDateDesc(posts).map((p) => p.date)).toEqual(['2026-04-20', '2026-02-15', '2026-01-10']);
    expect(buildBlogModel(posts, NOW).posts.map((p) => p.date)).toEqual([
      '2026-04-20',
      '2026-02-15',
      '2026-01-10',
    ]);
  });

  it('同日の記事はファイル名で安定ソートされる', () => {
    const same = [
      post({ fileName: '2026-04-01-zebra.md' }),
      post({ fileName: '2026-04-01-apple.md' }),
    ];
    expect(sortByDateDesc(same).map((p) => p.slug)).toEqual(['apple', 'zebra']);
  });

  it('タグ集計は件数降順・同数はタグ名昇順', () => {
    expect(computeTagCounts(posts)).toEqual([
      { tag: 'aws', count: 3 },
      { tag: 'docker', count: 1 },
      { tag: 'terraform', count: 1 },
    ]);
  });

  it('stats が投稿ペースを集計する', () => {
    const model = buildBlogModel(posts, NOW); // 基準日 2026-05-01
    expect(model.stats.lastPostDate).toBe('2026-04-20');
    expect(model.stats.daysSinceLastPost).toBe(11);
    // 2026-05-01 から 90 日以内は 2026-02-15 と 2026-04-20 の 2 件。
    expect(model.stats.postsLast90Days).toBe(2);
    expect(model.stats.freshness).toBe('fresh');
  });

  it('月別投稿数は直近 12 か月を古い順に、投稿ゼロの月も含めて返す', () => {
    const monthly = computeMonthlyCounts(posts, '2026-05-01');
    expect(monthly).toHaveLength(12);
    expect(monthly[0]?.month).toBe('2025-06');
    expect(monthly.at(-1)?.month).toBe('2026-05');
    expect(monthly.find((entry) => entry.month === '2026-04')?.count).toBe(1);
    expect(monthly.find((entry) => entry.month === '2026-03')?.count).toBe(0);
  });
});

describe('estimateReadingMinutes', () => {
  it('日本語本文で妥当な分数を返す（400 字/分）', () => {
    expect(estimateReadingMinutes('あ'.repeat(400))).toBe(1);
    expect(estimateReadingMinutes('あ'.repeat(1200))).toBe(3);
    expect(estimateReadingMinutes('日本語の文章です。'.repeat(200))).toBeGreaterThanOrEqual(4);
  });

  it('英文は 200 語/分で計算する', () => {
    expect(estimateReadingMinutes('word '.repeat(400))).toBe(2);
  });

  it('コードブロックは読了時間に数えない（流し読みするため）', () => {
    const withCode = `${'あ'.repeat(400)}\n\n\`\`\`ts\n${'const value = 1;\n'.repeat(80)}\`\`\`\n`;
    expect(estimateReadingMinutes(withCode)).toBe(1);
  });

  it('空の本文でも 0 分にはしない', () => {
    expect(estimateReadingMinutes('')).toBe(1);
  });
});

describe('ファイル読み込み（フィクスチャ）', () => {
  it('blog/posts 相当のディレクトリから記事を読める', async () => {
    const posts = await loadPostsFromDir(resolve(FIXTURES, 'posts'), 'posts');
    expect(posts).toHaveLength(1);
    expect(posts[0]?.fileName).toBe('2026-03-01-fixture-published.html');
    expect(posts[0]?.published).toBe(true);
  });

  it('drafts ディレクトリの記事は status: published でも非公開になる', async () => {
    const drafts = await loadPostsFromDir(resolve(FIXTURES, 'drafts'), 'drafts');
    expect(drafts[0]?.published).toBe(false);
  });

  it('存在しないディレクトリは空配列（記事を書き始める前の状態）', async () => {
    expect(await loadPostsFromDir(resolve(FIXTURES, 'missing'), 'posts')).toEqual([]);
  });
});

describe('レンダラ', () => {
  const generatedAt = '2026-05-01 12:00 (JST)';

  it('front matter 由来の文字列をエスケープする', () => {
    const malicious = buildBlogModel(
      [
        post({
          fileName: '2026-04-01-xss.md',
          title: '<script>alert(1)</script>',
          summary: '<img src=x onerror=alert(1)> を含む要約テキスト',
        }),
      ],
      NOW,
    );

    const index = renderBlogIndexPage(malicious, generatedAt);
    expect(index).not.toContain('<script>alert(1)</script>');
    expect(index).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(index).not.toContain('onerror=alert(1)>');

    const [page] = renderBlogPostPages(malicious, generatedAt);
    expect(page?.html).not.toContain('<script>alert(1)</script>');
    expect(page?.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');

    expect(renderBlogCard(malicious)).not.toContain('<script>alert(1)</script>');
  });

  it('記事 0 件でも全レンダラが例外を投げず、執筆を促す', () => {
    const empty = buildBlogModel([], NOW);
    expect(() => renderBlogIndexPage(empty, generatedAt)).not.toThrow();
    expect(renderBlogIndexPage(empty, generatedAt)).toContain('class="empty"');
    expect(renderBlogPostPages(empty, generatedAt)).toEqual([]);
    expect(renderBlogMarkdown(empty)).toMatch(/^## ブログ/);
    expect(renderBlogCard(empty)).toContain('<section class="card">');
  });

  it('index はサブディレクトリ基準の相対パスを使う', () => {
    const model = buildBlogModel([post()], NOW);
    const html = renderBlogIndexPage(model, generatedAt);
    expect(html).toContain('href="../assets/style.css"');
    expect(html).toContain('href="../index.html"');
    // 記事へのリンクは blog/ 内なのでファイル名のみ。
    expect(html).toContain('href="2026-04-01-test-post.html"');
  });

  it('記事ページは本文を .prose に入れ、前後の記事へのリンクを持つ', () => {
    const model = buildBlogModel(
      [
        post({ fileName: '2026-04-03-newer.md', date: '2026-04-03', title: '新しい記事' }),
        post({ fileName: '2026-04-02-middle.md', date: '2026-04-02', title: '真ん中の記事' }),
        post({ fileName: '2026-04-01-older.md', date: '2026-04-01', title: '古い記事' }),
      ],
      NOW,
    );
    const pages = renderBlogPostPages(model, generatedAt);
    expect(pages.map((page) => page.fileName)).toEqual([
      '2026-04-03-newer.html',
      '2026-04-02-middle.html',
      '2026-04-01-older.html',
    ]);

    const middle = pages[1]?.html ?? '';
    expect(middle).toContain('<article class="prose">');
    expect(middle).toContain('href="2026-04-01-older.html"');
    expect(middle).toContain('href="2026-04-03-newer.html"');
    expect(middle).toContain('href="index.html"');

    // 最新記事には「新しい記事」へのリンクが無い。
    expect(pages[0]?.html).not.toContain('href="2026-04-03-newer.html"');
  });

  it('記事ページは本文の Markdown を HTML に変換して埋め込む', () => {
    const html = renderedPostHtml(post({ body: '## 課題\n\n- 一つ目\n- 二つ目\n' }));
    expect(html).toContain('<h2>課題</h2>');
    expect(html).toContain('<li>一つ目</li>');
    // front matter が本文として漏れていないこと。
    expect(html).not.toContain('title:');
  });

  it('CRLF の記事でも本文が HTML に変換される', () => {
    const raw = article({ body: '## 課題\r\n\r\n本文。' }).replace(/\n/g, '\r\n');
    const html = renderedPostHtml(parsePost(raw, '2026-04-01-crlf.md', 'posts'));
    expect(html).toContain('<h2>課題</h2>');
  });

  it('Markdown 節は見出しから始まり、表セルのパイプと改行をエスケープする', () => {
    const model = buildBlogModel([post({ title: 'a | b' })], NOW);
    const markdown = renderBlogMarkdown(model);
    expect(markdown.startsWith('## ブログ')).toBe(true);
    expect(markdown).toContain('[a \\| b](blog/posts/2026-04-01-test-post.md)');

    // front matter の二重引用符スカラは \n を実際の改行として解釈するため、
    // タイトルに改行が入りうる。表の行が壊れないことを確認する。
    const multiline = buildBlogModel([post({ title: '"一行目\\n二行目"' })], NOW);
    const rows = renderBlogMarkdown(multiline).split('\n').filter((line) => line.startsWith('| 2026-'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain('一行目 二行目');
  });

  it('最終投稿から間が空くとカードが警告バッジを出す', () => {
    const veryStale = buildBlogModel([post({ fileName: '2026-01-01-old.md', date: '2026-01-01' })], NOW);
    expect(renderBlogCard(veryStale)).toContain('badge--risk');

    const stale = buildBlogModel([post({ fileName: '2026-03-15-mid.md', date: '2026-03-15' })], NOW);
    expect(renderBlogCard(stale)).toContain('badge--warn');

    const fresh = buildBlogModel([post({ fileName: '2026-04-28-new.md', date: '2026-04-28' })], NOW);
    expect(renderBlogCard(fresh)).toContain('badge--done');
  });
});

describe('new-post コマンドの引数解釈', () => {
  it('タイトルから slug を生成する', () => {
    expect(slugify('Terraform State Recovery!')).toBe('terraform-state-recovery');
    expect(slugify('日本語のタイトル')).toBe('');
  });

  it('日本語タイトルでは --slug を要求する', () => {
    let thrown: unknown;
    try {
      parseNewPostArgs(['日本語のタイトル', '--skills', 'soft-writing'], NOW);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(GrowthError);
    expect((thrown as GrowthError).message).toContain('slug を生成できませんでした');
    expect((thrown as GrowthError).details.join('\n')).toContain('--slug');
  });

  it('--tags 省略時は --skills と同じ値を使う', () => {
    const options = parseNewPostArgs(['My Post', '--skills', 'be-testing,lang-go'], NOW);
    expect(options.tags).toEqual(['be-testing', 'lang-go']);
    expect(options.date).toBe('2026-05-01');
    expect(options.draft).toBe(false);
  });

  it('--draft と --date を解釈する', () => {
    const options = parseNewPostArgs(
      ['My Post', '--skills=be-testing', '--date', '2026-06-01', '--draft'],
      NOW,
    );
    expect(options).toMatchObject({ slug: 'my-post', date: '2026-06-01', draft: true });
  });

  it('--skills の指定漏れ・未知のオプション・不正な日付を拒否する', () => {
    expect(() => parseNewPostArgs(['My Post'], NOW)).toThrowError(/--skills/);
    expect(() => parseNewPostArgs(['My Post', '--unknown'], NOW)).toThrowError(/未知のオプション/);
    expect(() =>
      parseNewPostArgs(['My Post', '--skills', 'be-testing', '--date', '2026/06/01'], NOW),
    ).toThrowError(GrowthError);
    expect(() => parseNewPostArgs(['One', 'Two', '--skills', 'be-testing'], NOW)).toThrowError(
      /タイトルが複数/,
    );
  });

  it('埋めた雛形がそのまま記事として検証を通る', async () => {
    const { readFile } = await import('node:fs/promises');
    const template = await readFile(resolve(FIXTURES, '..', '..', 'templates', 'blog-post.md'), 'utf8');
    const options = parseNewPostArgs(['Colon: in title', '--skills', 'be-testing'], NOW);
    const filled = fillTemplate(template, options);

    const parsed = parsePost(filled, `${options.date}-${options.slug}.md`, 'posts');
    expect(parsed.title).toBe('Colon: in title');
    expect(parsed.status).toBe('published');
  });
});
