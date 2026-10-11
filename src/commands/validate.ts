import { assertSkillReferences } from '../lib/consistency.ts';
import { loadBlogModel } from '../lib/blog.ts';
import { loadGoalsModel } from '../lib/goals.ts';
import { assertGoalReferences, loadRoadmapModel } from '../lib/roadmap.ts';
import { loadSkillsModel } from '../lib/skills.ts';
import type { Command } from './types.ts';

export const validateCommand: Command = {
  name: 'validate',
  summary: 'data/ と blog/ の全データをスキーマ・参照整合性の両面で検証する',
  async run({ log, now }) {
    // build と同じ基準日の渡し方にしておく（検証が通ったのに build で落ちる状況を避ける）
    const [skills, goals, roadmap, blog] = await Promise.all([
      loadSkillsModel(now),
      loadGoalsModel(now),
      loadRoadmapModel(now),
      loadBlogModel(now),
    ]);

    assertSkillReferences(skills.ids, [goals, roadmap, blog]);
    assertGoalReferences(goals.ids, [roadmap]);

    const pct = (ratio: number) => `${Math.round(ratio * 100)}%`;

    log(`skills   : ${skills.ids.length} 件 / 平均レベル ${skills.stats.averageLevel.toFixed(2)}`);
    // 達成率の分母は現四半期の目標（取りやめを除く）なので、件数と並べる際はスコープを書く
    log(
      `goals    : 全 ${goals.stats.all.total} 件 / ${goals.stats.focus.quarter} の達成率 ` +
        `${pct(goals.stats.focus.progress)} (対象 ${goals.stats.focus.total} 件)`,
    );
    log(
      `roadmap  : ${roadmap.milestones.length} マイルストーン / 完了率 ${pct(roadmap.stats.completion)}` +
        (roadmap.stats.overdue > 0 ? ` / 遅延 ${roadmap.stats.overdue} 件` : ''),
    );
    log(`blog     : ${blog.posts.length} 記事 (下書き ${blog.drafts.length} 件)`);

    // データとして不正ではないが、放置すると判断材料として腐る点を見えるようにする
    for (const warning of skills.warnings) log(`warning  : ${warning}`);
    if (goals.stale.length > 0) {
      log(`warning  : 期間が終わった未確定の目標が ${goals.stale.length} 件あります（振り返りを記入してください）`);
    }

    log('検証に成功しました。');
  },
};
