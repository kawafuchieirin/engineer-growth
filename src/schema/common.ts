import { z } from 'zod';

/**
 * ISO 8601 の日付（YYYY-MM-DD）。
 *
 * Date.parse は '2026-02-30' のような存在しない日付を黙って翌月に繰り上げる
 * （2026-03-02 として解釈される）ため、パース結果を元の文字列と突き合わせて弾く。
 * ここを緩くすると、後段の daysBetween（'...T00:00:00Z' でパースする）が
 * NaN を返し、原因から遠い場所で壊れる。
 */
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD 形式で記述してください')
  .refine((value) => {
    const [year, month, day] = value.split('-').map(Number) as [number, number, number];
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return (
      parsed.getUTCFullYear() === year &&
      parsed.getUTCMonth() === month - 1 &&
      parsed.getUTCDate() === day
    );
  }, '存在しない日付です');

/**
 * id に使う kebab-case。生成物の見出し・アンカー・ログにそのまま出すため、
 * 大文字・スペース・記号を許すと参照の表記揺れ（Goal-1 と goal-1）が生まれる。
 */
export const kebabId = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'id は kebab-case（英小文字・数字・ハイフン）で記述してください');

/** 配列中で 2 回以上現れた値を返す（出現順・重複なし）。スキーマの一意性検証で共用する。 */
export function duplicates(values: ReadonlyArray<string>): string[] {
  const seen = new Set<string>();
  const dups = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) dups.add(value);
    seen.add(value);
  }
  return [...dups];
}

/** YYYY-Qn 形式の四半期表記。 */
export const quarter = z
  .string()
  .regex(/^\d{4}-Q[1-4]$/, 'YYYY-Q1 のような四半期形式で記述してください');

/**
 * スキル熟練度。0〜5 の整数で、定義は data/levels.yaml を単一の情報源とする。
 * 数値にすることで差分・平均・レーダーチャートが計算できる。
 */
export const skillLevel = z.number().int().min(0).max(5);
export type SkillLevel = z.infer<typeof skillLevel>;

export const levelDefinition = z
  .object({
    level: skillLevel,
    name: z.string().min(1),
    description: z.string().min(1),
  })
  .strict();

export const levelsFile = z
  .object({
    levels: z.array(levelDefinition).length(6),
  })
  .strict();
export type LevelsFile = z.infer<typeof levelsFile>;
export type LevelDefinition = z.infer<typeof levelDefinition>;

/**
 * 資料・記事などへの参照リンク。
 *
 * z.string().url() は new URL() が通るものすべてを受けるため javascript: も通る。
 * 生成した HTML の href にそのまま載る値なので、スキームを http(s) に限定する。
 */
export const link = z
  .object({
    label: z.string().min(1),
    url: z
      .string()
      .url('URL の形式が不正です')
      .refine((value) => /^https?:\/\//i.test(value), 'URL は http:// または https:// で始めてください'),
  })
  .strict();
export type Link = z.infer<typeof link>;
