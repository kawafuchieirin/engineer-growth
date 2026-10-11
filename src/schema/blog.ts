import { z } from 'zod';
import { isoDate, kebabId, link } from './common.ts';

/**
 * 公開状態。`draft` はサイトに出力しないが下書き本数としては数える。
 * 省略を許すと「書き忘れ＝意図せぬ公開」になるため必須にしている。
 */
export const postStatus = z.enum(['published', 'draft']);
export type PostStatus = z.infer<typeof postStatus>;

/**
 * 記事の front matter。
 * strict にして未知フィールドを弾く（タイポした `tag:` が黙って無視されるのを防ぐ）。
 *
 * タグ・スキル ID・slug はいずれも kebab-case。表記揺れ（Terraform / terraform）が
 * あると集計が分裂しスキル ID の横断参照も成立しないが、その定義は
 * `schema/common.ts` の `kebabId` を単一の情報源とし、ここでは持たない。
 */
export const blogFrontMatter = z
  .object({
    title: z.string().trim().min(1, 'タイトルを記述してください'),
    date: isoDate,
    /** 記事の分類。一覧のタグ集計に使う。 */
    tags: z.array(kebabId).min(1, 'タグを 1 つ以上記述してください').max(8, 'タグは 8 個までにしてください'),
    /** data/skills.yaml のスキル ID。記事＝学びの記録をスキル棚卸しに紐付ける。 */
    skills: z
      .array(kebabId)
      .min(1, 'スキル ID を 1 つ以上記述してください（data/skills.yaml の id）')
      .max(8, 'スキル ID は 8 個までにしてください'),
    /** 一覧・カード・PROFILE.md に出る要約。短すぎる要約は要約として機能しない。 */
    summary: z.string().trim().min(10, '要約は 10 文字以上で記述してください'),
    status: postStatus,
    /** 参考にした資料へのリンク（任意）。 */
    links: z.array(link).optional(),
  })
  .strict();

export type BlogFrontMatter = z.infer<typeof blogFrontMatter>;

/**
 * `YYYY-MM-DD-slug.md` のファイル名規約。日付でソートでき、slug が URL になる。
 * slug 部分はここでは貪欲に切り出すだけにし、形式の検証は `kebabId` に委ねる
 * （kebab-case の正規表現を 2 箇所に持つと、片方だけ直して食い違う）。
 */
export const POST_FILE_NAME_PATTERN = /^(\d{4}-\d{2}-\d{2})-(.+)\.md$/;
