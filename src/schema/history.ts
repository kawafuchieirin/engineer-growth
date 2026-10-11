import { z } from 'zod';
import { duplicates, isoDate, kebabId } from './common.ts';

/**
 * 成長の記録（data/history.yaml）の構造検証。
 *
 * 他のスキーマと同じく `.strict()` で未知キーを弾く。履歴は append-only で、
 * 一度書いたら読み返すだけのファイルなので、タイポしたキーが黙って無視されると
 * 「その期間の記録だけ値が欠けている」状態に数ヶ月後まで気付けない。
 *
 * ここでは構造と自己整合性（合計が内訳と一致するか・日付が昇順か）だけを見る。
 * レベルが XP と整合するかの検証は行わない。それは集計（src/lib/xp.ts）の責務で、
 * スキーマから lib を参照するとレイヤの依存が逆向きになる。
 */

/** XP は常に整数・非負（src/lib/xp.ts が領域ごとに丸めてから合計する）。 */
const xpValue = z.number().int('XP は整数です（src/lib/xp.ts が丸めます）').min(0);

export const xpBreakdownSchema = z
  .object({
    skills: xpValue,
    goals: xpValue,
    roadmap: xpValue,
    blog: xpValue,
    achievements: xpValue,
    total: xpValue,
  })
  .strict()
  .superRefine((xp, ctx) => {
    // 合計と内訳のずれは「履歴を手で書き換えた」か「丸めの規則が変わった」の兆候。
    // どちらも過去との比較を無意味にするため、読み込み時点で止める。
    const sum = xp.skills + xp.goals + xp.roadmap + xp.blog + xp.achievements;
    if (sum !== xp.total) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['total'],
        message: `total (${xp.total}) が内訳の合計 (${sum}) と一致しません`,
      });
    }
  });

export const snapshotSchema = z
  .object({
    date: isoDate,
    xp: xpBreakdownSchema,
    level: z.number().int().min(0),
    /** スキルレベルの平均なので 0-5 の範囲に収まる（整数ではない）。 */
    skillAverage: z.number().min(0).max(5),
    skillCount: z.number().int().min(0),
    posts: z.number().int().min(0),
    milestonesDone: z.number().int().min(0),
    goalsDone: z.number().int().min(0),
    /** 解放済み実績の ID。他の ID と同じく kebab-case に揃える。 */
    achievements: z.array(kebabId),
  })
  .strict();

export type SnapshotRecord = z.infer<typeof snapshotSchema>;

export const historyFileSchema = z
  .object({
    snapshots: z.array(snapshotSchema),
  })
  .strict()
  .superRefine((file, ctx) => {
    for (const duplicate of duplicates(file.snapshots.map((snapshot) => snapshot.date))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['snapshots'],
        message: `同じ日付のスナップショットが重複しています: ${duplicate}（1 日 1 件に上書きしてください）`,
      });
    }

    // 昇順を保証しておくと、差分の計算が「末尾が最新・先頭が最初」だけで済む。
    // 並びが崩れたまま読めてしまうと「始めてから」の比較元が最初の記録でなくなり、
    // 伸びを過小・過大に見せる。ISO 8601 の日付は辞書順＝時系列順。
    file.snapshots.forEach((snapshot, index) => {
      const previous = file.snapshots[index - 1];
      if (previous && snapshot.date < previous.date) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['snapshots', index, 'date'],
          message: `日付が昇順になっていません: ${previous.date} の後に ${snapshot.date} があります`,
        });
      }
    });
  });

export type HistoryFile = z.infer<typeof historyFileSchema>;
