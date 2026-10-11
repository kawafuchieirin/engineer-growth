import { z } from 'zod';
import { duplicates, isoDate, kebabId, quarter } from './common.ts';

/**
 * 目標の状態。
 * dropped は「やらないと決めた」状態で、失敗（未達）とは区別する。
 * 達成率の分母から外すかどうかの判断に使うため、独立した値として持つ。
 */
export const GOAL_STATUSES = ['not_started', 'in_progress', 'done', 'dropped'] as const;
export const goalStatus = z.enum(GOAL_STATUSES);
export type GoalStatus = z.infer<typeof goalStatus>;

/** Key Result = 測定可能な成果。metric / target / current が揃って初めて進捗が計算できる。 */
export const keyResultSchema = z
  .object({
    id: kebabId,
    description: z.string().min(1, 'description は必須です'),
    metric: z.string().min(1, 'metric（何を数えるか）は必須です'),
    // 0 や負数を許すと進捗 current / target が計算不能になるため下限を外す。
    target: z.number().positive('target は 0 より大きい数値にしてください'),
    current: z.number().min(0, 'current は 0 以上の数値にしてください'),
    unit: z.string().min(1).optional(),
  })
  .strict();
export type KeyResult = z.infer<typeof keyResultSchema>;

export const goalSchema = z
  .object({
    id: kebabId,
    objective: z.string().min(1, 'objective は必須です'),
    quarter,
    status: goalStatus,
    // why を任意にすると「やると決めた理由」が失われ、途中の取捨選択ができなくなる。
    why: z.string().min(1, 'why（なぜやるのか）は必須です。判断の軸になります'),
    skills: z.array(kebabId).min(1, '関連スキル ID を 1 つ以上書いてください'),
    key_results: z.array(keyResultSchema).min(1, 'Key Result を 1 つ以上書いてください'),
    retrospective: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((goal, ctx) => {
    for (const duplicate of duplicates(goal.key_results.map((kr) => kr.id))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['key_results'],
        message: `Key Result の id "${duplicate}" が目標 "${goal.id}" 内で重複しています`,
      });
    }
  });
export type Goal = z.infer<typeof goalSchema>;

/** 2〜3 年後のありたい姿。四半期目標がここに向いているかを確認するための基準。 */
export const horizonSchema = z
  .object({
    vision: z.string().min(1, 'vision は必須です'),
    updated: isoDate,
  })
  .strict();
export type Horizon = z.infer<typeof horizonSchema>;

export const goalsFileSchema = z
  .object({
    horizon: horizonSchema,
    goals: z.array(goalSchema).min(1, '目標を 1 つ以上書いてください'),
  })
  .strict()
  .superRefine((file, ctx) => {
    for (const duplicate of duplicates(file.goals.map((goal) => goal.id))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['goals'],
        message: `目標の id "${duplicate}" が重複しています`,
      });
    }
  });
export type GoalsFile = z.infer<typeof goalsFileSchema>;
