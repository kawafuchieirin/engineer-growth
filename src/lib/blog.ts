import { resolve } from 'node:path';
import { blogFrontMatter, POST_FILE_NAME_PATTERN, type BlogFrontMatter, type PostStatus } from '../schema/blog.ts';
import { kebabId, type Link } from '../schema/common.ts';
import { parse as parseYaml } from 'yaml';
import { daysBetween, toJstDate } from './date.ts';
import { GrowthError } from './errors.ts';
import { listFiles, readFile } from './io.ts';
import { paths } from './paths.ts';

/** 記事ファイルの置き場所。`drafts` は status に関わらず下書き扱い。 */
export type PostOrigin = 'posts' | 'drafts';

export interface BlogPost {
  /** 出力する HTML のファイル名（`YYYY-MM-DD-slug.html`）。 */
  readonly fileName: string;
  /** エラーメッセージ・参照元表示に使う元ファイルの相対パス。 */
  readonly sourcePath: string;
  readonly slug: string;
  readonly title: string;
  readonly date: string;
  readonly tags: ReadonlyArray<string>;
  readonly skills: ReadonlyArray<string>;
  readonly summary: string;
  readonly status: PostStatus;
  readonly links: ReadonlyArray<Link>;
  /**
   * Markdown 本文（front matter を除いた部分）。
   * HTML 化はレンダラの責務なので、ここでは変換前の Markdown のまま持つ
   * （docs/ARCHITECTURE.md: lib は HTML 文字列を作らない）。
   */
  readonly markdown: string;
  readonly readingMinutes: number;
  /** サイトに出力するか。`blog/drafts/` 配下、または status: draft なら false。 */
  readonly published: boolean;
}

/**
 * 最終投稿からの間隔で見た「鮮度」。公開記事が 1 本も無ければ `none`。
 * 閾値の判断を lib に置き、レンダラはこの値をバッジに写すだけにする
 * （goals の at-risk・skills の stale と同じ役割分担）。
 */
export type BlogFreshness = 'fresh' | 'stale' | 'very-stale' | 'none';

/**
 * 鮮度判定のしきい値（日数）。
 * 「月 1 本は書く」を最低ラインとしているので 30 日超で警告、
 * 四半期（90 日）書いていなければ赤信号にする。
 */
export const STALE_DAYS = 30;
export const VERY_STALE_DAYS = 90;

export interface TagCount {
  readonly tag: string;
  readonly count: number;
}

export interface MonthlyCount {
  /** `YYYY-MM`。 */
  readonly month: string;
  readonly count: number;
}

export interface BlogStats {
  /** 公開記事の総数。 */
  readonly totalPosts: number;
  readonly draftCount: number;
  /** 直近 90 日の公開記事数（投稿ペースの指標）。 */
  readonly postsLast90Days: number;
  /** 最終投稿日。公開記事が無ければ null。 */
  readonly lastPostDate: string | null;
  /** 最終投稿日からの経過日数。公開記事が無ければ null。 */
  readonly daysSinceLastPost: number | null;
  /** 最終投稿からの間隔で見た鮮度。表示上のバッジはこれを写す。 */
  readonly freshness: BlogFreshness;
  /** 直近 12 か月の月別投稿数（古い順。投稿が無い月も 0 件として含む）。 */
  readonly monthly: ReadonlyArray<MonthlyCount>;
}

export interface BlogModel {
  /** 公開記事。日付降順（契約）。 */
  readonly posts: ReadonlyArray<BlogPost>;
  /** 下書き（`blog/drafts/` 配下 または status: draft）。日付降順。 */
  readonly drafts: ReadonlyArray<BlogPost>;
  /** 参照しているスキル ID と出所。下書きも腐敗検出の対象に含める。 */
  readonly referencedSkillIds: ReadonlyArray<{ id: string; source: string }>;
  /** タグごとの記事数。件数降順（同数ならタグ名昇順）。 */
  readonly tags: ReadonlyArray<TagCount>;
  readonly stats: BlogStats;
}

/** front matter の区切り行。前後の空白のみ許容する。 */
const DELIMITER = /^---[ \t]*$/;

export interface ParsedFrontMatter {
  readonly data: BlogFrontMatter;
  readonly body: string;
}

/**
 * front matter を取り出して検証する。
 * 区切り行の検出だけを正規表現で行い、YAML 本体の解釈は `yaml` パッケージに任せる
 * （自前パーサは引用符・複数行・flow コレクションで必ず破綻するため）。
 */
export function parseFrontMatter(raw: string, sourcePath: string): ParsedFrontMatter {
  // BOM と CRLF をここで正規化する。以降の処理は LF だけを前提にできる。
  const text = raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const lines = text.split('\n');

  const firstMeaningful = lines.findIndex((line) => line.trim() !== '');
  if (firstMeaningful === -1 || !DELIMITER.test(lines[firstMeaningful] ?? '')) {
    throw new GrowthError(`front matter がありません: ${sourcePath}`, [
      '記事の先頭を `---` で始め、title / date / tags / skills / summary / status を記述してください',
      'templates/blog-post.md を雛形として使えます',
    ]);
  }

  const closing = lines.findIndex((line, index) => index > firstMeaningful && DELIMITER.test(line));
  if (closing === -1) {
    throw new GrowthError(`front matter が閉じられていません: ${sourcePath}`, [
      '2 行目以降に閉じの `---` を記述してください',
    ]);
  }

  const frontMatterText = lines.slice(firstMeaningful + 1, closing).join('\n');
  const body = lines.slice(closing + 1).join('\n').trim();

  let parsed: unknown;
  try {
    parsed = parseYaml(frontMatterText);
  } catch (cause) {
    throw new GrowthError(`front matter の YAML 構文エラー: ${sourcePath}`, [
      cause instanceof Error ? cause.message : String(cause),
    ]);
  }

  const result = blogFrontMatter.safeParse(parsed);
  if (!result.success) {
    throw new GrowthError(`front matter の検証に失敗しました: ${sourcePath}`, [
      ...result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
    ]);
  }

  return { data: result.data, body };
}

/**
 * 日本語・英語を分けた概算読了時間（分）。
 * 根拠: 日本語の黙読は 400〜600 字/分、英語は 200〜250 語/分とされるので
 * 保守的な下限（日本語 400 字/分・英語 200 語/分）を採用する。
 * コードブロックは通読せず流し読みするため計測対象から外す。
 */
export function estimateReadingMinutes(markdown: string): number {
  const prose = markdown
    .replace(/```[\s\S]*?```/g, ' ') // フェンス付きコードブロックを除外
    .replace(/`[^`]*`/g, ' ') // インラインコード
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1') // リンク・画像は表示テキストのみ数える
    .replace(/<[^>]+>/g, ' ') // 生 HTML タグ
    .replace(/^[>#\-*+|\s]+/gm, ' '); // 見出し・リスト・引用・表の記号

  const japaneseChars = prose.match(/[぀-ヿ㐀-䶿一-鿿豈-﫿ｦ-ﾟ]/g)?.length ?? 0;
  const latinWords = prose.match(/[A-Za-z][A-Za-z'’-]*/g)?.length ?? 0;

  const minutes = japaneseChars / 400 + latinWords / 200;
  // 本文が空でも「0 分」とは表示したくないので最低 1 分に丸める。
  return Math.max(1, Math.ceil(minutes));
}

/** `YYYY-MM-DD-slug.md` を検証して日付と slug を取り出す。 */
function parseFileName(fileName: string, sourcePath: string): { date: string; slug: string } {
  const matched = POST_FILE_NAME_PATTERN.exec(fileName);
  // slug の形式はスキーマ（kebabId）に判定させる。正規表現を二重に持たない。
  if (!matched || !matched[1] || !matched[2] || !kebabId.safeParse(matched[2]).success) {
    throw new GrowthError(`記事のファイル名が規約に合っていません: ${sourcePath}`, [
      '`YYYY-MM-DD-slug.md`（slug は kebab-case）で命名してください',
    ]);
  }
  return { date: matched[1], slug: matched[2] };
}

/**
 * 1 記事分の Markdown を検証済みモデルにする。
 * 失敗は必ず GrowthError。黙って skip すると壊れた記事が永久に埋もれるため。
 */
export function parsePost(raw: string, fileName: string, origin: PostOrigin): BlogPost {
  const sourcePath = `blog/${origin}/${fileName}`;
  const { date: fileDate, slug } = parseFileName(fileName, sourcePath);
  const { data, body } = parseFrontMatter(raw, sourcePath);

  if (data.date !== fileDate) {
    throw new GrowthError(`ファイル名の日付と front matter の date が一致しません: ${sourcePath}`, [
      `ファイル名: ${fileDate} / front matter: ${data.date}`,
      '日付を変更する場合はファイル名もリネームしてください',
    ]);
  }

  return {
    fileName: `${fileDate}-${slug}.html`,
    sourcePath,
    slug,
    title: data.title,
    date: data.date,
    tags: data.tags,
    skills: data.skills,
    summary: data.summary,
    status: data.status,
    links: data.links ?? [],
    markdown: body,
    readingMinutes: estimateReadingMinutes(body),
    published: origin === 'posts' && data.status === 'published',
  };
}

/** 日付降順（同日ならファイル名昇順で安定させる）。 */
export function sortByDateDesc(posts: ReadonlyArray<BlogPost>): BlogPost[] {
  return [...posts].sort((a, b) =>
    a.date === b.date ? a.fileName.localeCompare(b.fileName) : b.date.localeCompare(a.date),
  );
}

/** タグごとの記事数。件数降順・同数はタグ名昇順。 */
export function computeTagCounts(posts: ReadonlyArray<BlogPost>): TagCount[] {
  const counts = new Map<string, number>();
  for (const post of posts) {
    for (const tag of post.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => (b.count === a.count ? a.tag.localeCompare(b.tag) : b.count - a.count));
}

/** 直近 months か月の月別投稿数（古い順）。投稿ゼロの月も含めてペースの谷が見えるようにする。 */
export function computeMonthlyCounts(
  posts: ReadonlyArray<BlogPost>,
  today: string,
  months = 12,
): MonthlyCount[] {
  const counts = new Map<string, number>();
  for (const post of posts) {
    const month = post.date.slice(0, 7);
    counts.set(month, (counts.get(month) ?? 0) + 1);
  }

  const [year, month] = [Number(today.slice(0, 4)), Number(today.slice(5, 7))];
  const result: MonthlyCount[] = [];
  for (let offset = months - 1; offset >= 0; offset -= 1) {
    // Date の月繰り下がりを使って YYYY-MM を機械的に生成する。
    const cursor = new Date(Date.UTC(year, month - 1 - offset, 1));
    const key = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`;
    result.push({ month: key, count: counts.get(key) ?? 0 });
  }
  return result;
}

/** 最終投稿からの経過日数を鮮度に写す。境界は「超えたら」なので 30 日ちょうどは fresh。 */
export function computeFreshness(daysSinceLastPost: number | null): BlogFreshness {
  if (daysSinceLastPost === null) return 'none';
  if (daysSinceLastPost > VERY_STALE_DAYS) return 'very-stale';
  if (daysSinceLastPost > STALE_DAYS) return 'stale';
  return 'fresh';
}

/**
 * 公開記事の未来日を拒否する。
 *
 * この仕組みに予約投稿は無く、未来日の `status: published` は date の書き間違いである
 * 可能性が高い。Math.max(0, …) で丸めると経過日数の負値は消えるが、間違った日付が
 * 一覧の並び順・月別ペースに残り続ける（＝データの誤りが隠れる）ため、明示的に失敗させる。
 * `status: draft` の未来日は「執筆予定日」として使えるので許容する。
 */
function assertNoFuturePublishedPosts(posts: ReadonlyArray<BlogPost>, today: string): void {
  const future = posts.filter((post) => post.date > today);
  if (future.length === 0) return;

  throw new GrowthError(`公開記事の日付が未来になっています（基準日: ${today}）`, [
    ...future.map((post) => `${post.sourcePath}: date ${post.date}`),
    '予約投稿の仕組みは無いため、date とファイル名の日付を実際の公開日に直してください',
    '執筆予定日として未来日を置きたい場合は status: draft にしてください（下書きは未来日を許容します）',
  ]);
}

export function computeStats(
  posts: ReadonlyArray<BlogPost>,
  drafts: ReadonlyArray<BlogPost>,
  today: string,
): BlogStats {
  const lastPostDate = posts.reduce<string | null>(
    (latest, post) => (latest === null || post.date > latest ? post.date : latest),
    null,
  );

  const daysSinceLastPost = lastPostDate === null ? null : daysBetween(lastPostDate, today);

  return {
    totalPosts: posts.length,
    draftCount: drafts.length,
    // 公開記事に未来日は無い（assertNoFuturePublishedPosts で弾く）ので日数は常に 0 以上。
    postsLast90Days: posts.filter((post) => daysBetween(post.date, today) <= 90).length,
    lastPostDate,
    daysSinceLastPost,
    freshness: computeFreshness(daysSinceLastPost),
    monthly: computeMonthlyCounts(posts, today),
  };
}

/** 検証済み記事からモデルを組み立てる純粋関数。I/O を伴わないのでテストしやすい。 */
export function buildBlogModel(parsed: ReadonlyArray<BlogPost>, now: Date): BlogModel {
  const sorted = sortByDateDesc(parsed);
  const posts = sorted.filter((post) => post.published);
  const drafts = sorted.filter((post) => !post.published);
  const today = toJstDate(now);

  assertNoFuturePublishedPosts(posts, today);

  return {
    posts,
    drafts,
    // 下書きのスキル ID も検証する。公開時に初めて壊れていると気付くのは遅すぎる。
    referencedSkillIds: sorted.flatMap((post) =>
      post.skills.map((id) => ({ id, source: post.sourcePath })),
    ),
    tags: computeTagCounts(posts),
    stats: computeStats(posts, drafts, today),
  };
}

/** 指定ディレクトリの Markdown を全件パースする。I/O は listFiles / readFile 経由のみ。 */
export async function loadPostsFromDir(dir: string, origin: PostOrigin): Promise<BlogPost[]> {
  const fileNames = await listFiles(dir, '.md');
  const posts: BlogPost[] = [];
  for (const fileName of fileNames) {
    const raw = await readFile(resolve(dir, fileName), 'utf8');
    posts.push(parsePost(raw, fileName, origin));
  }
  return posts;
}

/**
 * blog/posts と blog/drafts を読み込んでモデルを返す。
 * now を引数にしているのは「経過日数」の基準日をテストから固定するため。
 */
export async function loadBlogModel(now: Date = new Date()): Promise<BlogModel> {
  const [posts, drafts] = await Promise.all([
    loadPostsFromDir(paths.blogPosts, 'posts'),
    loadPostsFromDir(paths.blogDrafts, 'drafts'),
  ]);
  return buildBlogModel([...posts, ...drafts], now);
}
