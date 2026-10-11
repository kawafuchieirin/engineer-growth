import { z } from 'zod';
import { isoDate, kebabId, link, skillLevel } from './common.ts';

/** 「最後に使った時期」は日単位の精度に意味がないため YYYY-MM で持つ。 */
export const yearMonth = z
  .string()
  .regex(/^\d{4}-(?:0[1-9]|1[0-2])$/, 'YYYY-MM 形式で記述してください');

/**
 * どのオブジェクトも .strict() にして未知キーを拒否する。
 * 未知キーを捨てると `taget: 5`（target のタイポ）が検証を通り、
 * 「目標未設定＝現状維持」と誤って集計されてしまう。黙って無視するより壊す。
 */
export const skillCategoryDefinition = z
  .object({
    // ID は URL / アンカー / 他データからの参照に使うため kebab-case に限定する（正は common.ts）。
    id: kebabId,
    name: z.string().min(1),
    /** 自分のキャリアにおける重み。極端な値で平均が壊れないよう 0.1-2.0 に制限する。 */
    weight: z.number().min(0.1, '0.1 以上で指定してください').max(2.0, '2.0 以下で指定してください'),
  })
  .strict();

export const skill = z
  .object({
    id: kebabId,
    name: z.string().min(1),
    category: kebabId,
    level: skillLevel,
    /**
     * 目標レベル。未設定なら「現状維持」とみなす。
     * level > target（過去に下げた目標）も実態としてそのまま記録できるよう許す。
     * 集計側の扱いは src/lib/skills.ts の targetOf を参照。
     */
    target: skillLevel.optional(),
    experience_years: z.number().min(0).max(60).optional(),
    last_used: yearMonth.optional(),
    /** レベルの根拠。レベル 3 以上で空の場合はモデル側が warning を出す。 */
    evidence: z.array(z.string().min(1)).optional(),
    links: z.array(link).optional(),
    notes: z.string().min(1).optional(),
  })
  .strict();

export const skillsOwner = z
  .object({
    name: z.string().min(1),
    role: z.string().min(1),
    updated: isoDate,
  })
  .strict();

const skillsFileShape = z
  .object({
    owner: skillsOwner,
    categories: z.array(skillCategoryDefinition).min(1, 'カテゴリを 1 件以上定義してください'),
    skills: z.array(skill).min(1, 'スキルを 1 件以上定義してください'),
  })
  .strict();

/**
 * data/skills.yaml のスキーマ。
 * 構造検証だけでは「存在しないカテゴリを参照した」「ID が重複した」という
 * データの腐敗を検出できないため、意味的な検証を superRefine で重ねる。
 */
export const skillsFile = skillsFileShape.superRefine((file, ctx) => {
  const seenCategories = new Set<string>();
  for (const [index, category] of file.categories.entries()) {
    if (seenCategories.has(category.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['categories', index, 'id'],
        message: `カテゴリ id "${category.id}" が重複しています`,
      });
    }
    seenCategories.add(category.id);
  }

  const seenSkills = new Set<string>();
  for (const [index, entry] of file.skills.entries()) {
    if (seenSkills.has(entry.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['skills', index, 'id'],
        message: `スキル id "${entry.id}" が重複しています`,
      });
    }
    seenSkills.add(entry.id);

    if (!seenCategories.has(entry.category)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['skills', index, 'category'],
        message: `未定義のカテゴリ "${entry.category}" を参照しています（categories に追加してください）`,
      });
    }
  }
});

export type SkillsFile = z.infer<typeof skillsFile>;
export type Skill = z.infer<typeof skill>;
export type SkillCategoryDefinition = z.infer<typeof skillCategoryDefinition>;
export type SkillsOwner = z.infer<typeof skillsOwner>;
