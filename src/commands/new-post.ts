import { mkdir, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { parsePost } from '../lib/blog.ts';
import { toJstDate } from '../lib/date.ts';
import { GrowthError } from '../lib/errors.ts';
import { readFile } from '../lib/io.ts';
import { paths } from '../lib/paths.ts';
import { isoDate, kebabId } from '../schema/common.ts';
import type { Command, CommandContext } from './types.ts';

const USAGE = `new-post: ブログ記事の雛形を作成する

使い方:
  pnpm growth new-post "<記事タイトル>" --skills <id,...> [options]

オプション:
  --slug <slug>      ファイル名に使う slug（kebab-case）。省略時はタイトルから生成する。
                     日本語タイトルは英数字が取れないため --slug が必須になる。
  --skills <id,...>  data/skills.yaml のスキル ID をカンマ区切りで指定（必須）。
  --tags <tag,...>   タグをカンマ区切りで指定。省略時は --skills と同じ値を使う。
  --date <YYYY-MM-DD> 記事の日付。省略時は今日（JST）。
  --draft            blog/drafts/ に作成する（サイトには出力されない）。

例:
  pnpm growth new-post "Terraform の state を壊して復旧した" \\
    --slug terraform-state-recovery \\
    --skills infra-terraform,cloud-aws \\
    --tags terraform,aws
  pnpm growth new-post "Weekly retrospective" --skills soft-writing --draft`;

interface NewPostOptions {
  title: string;
  slug: string;
  skills: string[];
  tags: string[];
  date: string;
  draft: boolean;
}

/**
 * タイトルから slug を生成する。
 * 英数字以外は区切りとして落とすため、日本語のみのタイトルでは空文字になる。
 * その場合は呼び出し側が --slug を要求する（勝手にローマ字化すると誤変換が URL に残る）。
 */
export function slugify(title: string): string {
  return title
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function takeValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new GrowthError(`${flag} に値が指定されていません`, [USAGE]);
  }
  return value;
}

function splitList(value: string, flag: string): string[] {
  const items = value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
  if (items.length === 0) throw new GrowthError(`${flag} が空です`, [USAGE]);

  const invalid = items.filter((item) => !kebabId.safeParse(item).success);
  if (invalid.length > 0) {
    throw new GrowthError(`${flag} の値が kebab-case ではありません: ${invalid.join(', ')}`, [
      '英小文字・数字・ハイフンのみを使ってください（例: infra-terraform）',
    ]);
  }
  return items;
}

/** 引数列をオプションに変換する純粋関数（テストしやすいように export する）。 */
export function parseNewPostArgs(args: string[], now: Date): NewPostOptions {
  let title: string | undefined;
  let slug: string | undefined;
  let skills: string[] | undefined;
  let tags: string[] | undefined;
  let date: string | undefined;
  let draft = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? '';
    // `--flag=value` と `--flag value` の両方を受ける。
    const [flag, inlineValue] = arg.startsWith('--') && arg.includes('=')
      ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)]
      : [arg, undefined];

    switch (flag) {
      case '--slug':
        slug = inlineValue ?? takeValue(args, index, '--slug');
        if (inlineValue === undefined) index += 1;
        break;
      case '--skills':
        skills = splitList(inlineValue ?? takeValue(args, index, '--skills'), '--skills');
        if (inlineValue === undefined) index += 1;
        break;
      case '--tags':
        tags = splitList(inlineValue ?? takeValue(args, index, '--tags'), '--tags');
        if (inlineValue === undefined) index += 1;
        break;
      case '--date':
        date = inlineValue ?? takeValue(args, index, '--date');
        if (inlineValue === undefined) index += 1;
        break;
      case '--draft':
        draft = true;
        break;
      default:
        if (flag.startsWith('-')) throw new GrowthError(`未知のオプション: ${flag}`, [USAGE]);
        if (title !== undefined) {
          throw new GrowthError('タイトルが複数指定されています', [
            'タイトルは引用符で囲んで 1 つだけ渡してください',
            USAGE,
          ]);
        }
        title = arg;
    }
  }

  if (title === undefined || title.trim() === '') {
    throw new GrowthError('記事タイトルを指定してください', [USAGE]);
  }
  if (skills === undefined) {
    throw new GrowthError('--skills を指定してください', [
      '記事を data/skills.yaml のスキル ID に紐付けることで、学びがスキル棚卸しに反映されます',
      USAGE,
    ]);
  }

  const resolvedSlug = slug ?? slugify(title);
  if (resolvedSlug === '') {
    throw new GrowthError('タイトルから slug を生成できませんでした', [
      `タイトル "${title}" には英数字が含まれていないため、--slug で URL 用の slug を指定してください`,
      '例: --slug terraform-state-recovery',
    ]);
  }
  if (!kebabId.safeParse(resolvedSlug).success) {
    throw new GrowthError(`slug が kebab-case ではありません: ${resolvedSlug}`, [
      '英小文字・数字・ハイフンのみを使ってください',
    ]);
  }

  const resolvedDate = date ?? toJstDate(now);
  if (!isoDate.safeParse(resolvedDate).success) {
    throw new GrowthError(`--date の形式が不正です: ${resolvedDate}`, ['YYYY-MM-DD で指定してください']);
  }

  return {
    title: title.trim(),
    slug: resolvedSlug,
    skills,
    // タグ未指定ならスキル ID をそのままタグにする（二重入力を避ける。あとで手で直せばよい）
    tags: tags ?? skills,
    date: resolvedDate,
    draft,
  };
}

/** front matter に埋める YAML スカラ。引用符や `:` を含むタイトルでも壊れないよう yaml に任せる。 */
function yamlScalar(value: string): string {
  return stringifyYaml(value).trim();
}

/** kebab-case のみを要素に持つため、flow 形式を手で組んでも YAML として安全。 */
function yamlFlowList(values: ReadonlyArray<string>): string {
  return `[${values.join(', ')}]`;
}

export function fillTemplate(template: string, options: NewPostOptions): string {
  const values: Record<string, string> = {
    title: yamlScalar(options.title),
    date: options.date,
    tags: yamlFlowList(options.tags),
    skills: yamlFlowList(options.skills),
    summary: yamlScalar('TODO: この記事で何が分かるのかを 1〜2 文で書く'),
    status: options.draft ? 'draft' : 'published',
  };

  return template.replace(/\{\{(\w+)\}\}/g, (placeholder, key: string) => {
    const value = values[key];
    if (value === undefined) {
      throw new GrowthError(`テンプレートに未知のプレースホルダがあります: ${placeholder}`, [
        'templates/blog-post.md を確認してください',
      ]);
    }
    return value;
  });
}

export const newPostCommand: Command = {
  name: 'new-post',
  summary: 'blog/posts または blog/drafts に記事の雛形を作成する',
  usage: USAGE,
  async run({ args, log, now }: CommandContext) {
    const options = parseNewPostArgs(args, now);
    const fileName = `${options.date}-${options.slug}.md`;
    const dir = options.draft ? paths.blogDrafts : paths.blogPosts;
    const filePath = resolve(dir, fileName);

    const templatePath = resolve(paths.templates, 'blog-post.md');
    let template: string;
    try {
      template = await readFile(templatePath, 'utf8');
    } catch (cause) {
      throw new GrowthError(`雛形を読み込めません: ${relative(paths.root, templatePath)}`, [
        cause instanceof Error ? cause.message : String(cause),
      ]);
    }

    const contents = fillTemplate(template, options);

    // 生成直後に自分でパースして、雛形の崩れ（プレースホルダ漏れ・YAML 不正）を
    // 「あとで build が落ちる」ではなく「作成時に落ちる」に変える。
    parsePost(contents, fileName, options.draft ? 'drafts' : 'posts');

    await mkdir(dir, { recursive: true });
    try {
      // 'wx' で既存ファイルを上書きしない（書きかけの記事を失う事故を防ぐ）。
      await writeFile(filePath, contents, { encoding: 'utf8', flag: 'wx' });
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new GrowthError(`同名の記事が既に存在します: ${relative(paths.root, filePath)}`, [
          '--slug または --date を変えてください',
        ]);
      }
      throw cause;
    }

    log(`作成しました: ${relative(paths.root, filePath)}`);
    log('front matter の summary を書き換えてから本文を書き始めてください。');
    if (options.draft) log('下書きはサイトに出力されません。公開するときは blog/posts/ へ移動し status: published にします。');
  },
};
