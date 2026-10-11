import { z } from 'zod';
import { duplicates, isoDate, kebabId } from './common.ts';

/**
 * マイルストーンの状態。
 * blocked は「自分の努力では進められない」状態で、planned（まだ着手しない）とは分ける。
 * 分けておくと、棚卸しのときに「待ちを解消する行動」を別に起こせる。
 */
export const MILESTONE_STATUSES = ['planned', 'in_progress', 'done', 'blocked'] as const;
export const milestoneStatus = z.enum(MILESTONE_STATUSES);
export type MilestoneStatus = z.infer<typeof milestoneStatus>;

/** マイルストーンを構成する作業。done の比率がそのまま進捗になる。 */
export const stepSchema = z
  .object({
    description: z.string().min(1, 'description は必須です'),
    done: z.boolean(),
  })
  .strict();
export type Step = z.infer<typeof stepSchema>;

/** ロードマップの縦軸。並行して伸ばす領域を表す。 */
export const trackSchema = z
  .object({
    id: kebabId,
    name: z.string().min(1, 'name は必須です'),
  })
  .strict();
export type Track = z.infer<typeof trackSchema>;

export const milestoneSchema = z
  .object({
    id: kebabId,
    title: z.string().min(1, 'title は必須です'),
    track: kebabId,
    status: milestoneStatus,
    start: isoDate,
    due: isoDate,
    skills: z.array(kebabId).min(1, '関連スキル ID を 1 つ以上書いてください'),
    goals: z.array(kebabId).optional(),
    // outcome が曖昧だと「終わったかどうか」を後から自分に都合よく判定してしまう。
    outcome: z.string().min(1, 'outcome（達成状態の定義）は必須です'),
    steps: z.array(stepSchema).min(1, 'steps を 1 つ以上書いてください'),
    depends_on: z.array(kebabId).optional(),
    blocked_reason: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((milestone, ctx) => {
    // ISO 8601 の日付は辞書順と時系列順が一致するため文字列比較でよい。
    if (milestone.start > milestone.due) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['due'],
        message: `start (${milestone.start}) が due (${milestone.due}) より後になっています`,
      });
    }

    // 理由のない blocked は放置されるだけで何の行動にもつながらない。
    if (milestone.status === 'blocked' && !milestone.blocked_reason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['blocked_reason'],
        message: `status が blocked のマイルストーン "${milestone.id}" には blocked_reason が必要です`,
      });
    }

    if (milestone.depends_on?.includes(milestone.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['depends_on'],
        message: `マイルストーン "${milestone.id}" が自分自身に依存しています`,
      });
    }

    for (const duplicate of duplicates(milestone.depends_on ?? [])) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['depends_on'],
        message: `depends_on の "${duplicate}" が重複しています`,
      });
    }
  });
export type Milestone = z.infer<typeof milestoneSchema>;

/** depends_on をたどって循環を探し、見つかった閉路を "a → b → a" の形で返す。 */
function findDependencyCycle(milestones: ReadonlyArray<Milestone>): string[] | undefined {
  const dependencies = new Map(milestones.map((m) => [m.id, m.depends_on ?? []] as const));
  const visited = new Set<string>();
  const stack: string[] = [];
  const onStack = new Set<string>();

  const walk = (id: string): string[] | undefined => {
    if (onStack.has(id)) return [...stack.slice(stack.indexOf(id)), id];
    if (visited.has(id)) return undefined;

    visited.add(id);
    onStack.add(id);
    stack.push(id);
    for (const next of dependencies.get(id) ?? []) {
      // 未定義の依存先は別のチェックで報告するのでここでは踏み込まない。
      if (!dependencies.has(next)) continue;
      const cycle = walk(next);
      if (cycle) return cycle;
    }
    stack.pop();
    onStack.delete(id);
    return undefined;
  };

  for (const milestone of milestones) {
    const cycle = walk(milestone.id);
    if (cycle) return cycle;
  }
  return undefined;
}

export const roadmapFileSchema = z
  .object({
    updated: isoDate,
    tracks: z.array(trackSchema).min(1, 'track を 1 つ以上定義してください'),
    milestones: z.array(milestoneSchema).min(1, 'マイルストーンを 1 つ以上書いてください'),
  })
  .strict()
  .superRefine((file, ctx) => {
    for (const duplicate of duplicates(file.tracks.map((track) => track.id))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['tracks'],
        message: `track の id "${duplicate}" が重複しています`,
      });
    }
    for (const duplicate of duplicates(file.milestones.map((milestone) => milestone.id))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['milestones'],
        message: `マイルストーンの id "${duplicate}" が重複しています`,
      });
    }

    const trackIds = new Set(file.tracks.map((track) => track.id));
    const milestoneIds = new Set(file.milestones.map((milestone) => milestone.id));

    file.milestones.forEach((milestone, index) => {
      if (!trackIds.has(milestone.track)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['milestones', index, 'track'],
          message: `未定義の track "${milestone.track}" を参照しています（tracks に追加してください）`,
        });
      }
      for (const dependency of milestone.depends_on ?? []) {
        if (!milestoneIds.has(dependency)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['milestones', index, 'depends_on'],
            message: `存在しないマイルストーン "${dependency}" に依存しています`,
          });
        }
      }
    });

    // 循環依存を許すと「どれから手を付けるか」が決まらず、計画として成立しない。
    const cycle = findDependencyCycle(file.milestones);
    if (cycle) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['milestones'],
        message: `depends_on が循環しています: ${cycle.join(' → ')}`,
      });
    }
  });
export type RoadmapFile = z.infer<typeof roadmapFileSchema>;
