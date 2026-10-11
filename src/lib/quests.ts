import { ACHIEVEMENT_QUEST_TARGETS } from './achievements.ts';
import type { BlogModel } from './blog.ts';
import { daysBetween } from './date.ts';
import type { AchievementStatus, Quest, StreakInfo } from './game-types.ts';
import { AT_RISK_WITHIN_DAYS, type GoalsModel } from './goals.ts';
import type { RoadmapModel } from './roadmap.ts';
import { EVIDENCE_REQUIRED_LEVEL, type SkillsModel } from './skills.ts';
// XP の見込みは src/lib/xp.ts の係数をそのまま使う（正は docs/GAME_DESIGN.md「XP の計算」節）。
// 同じ数字を 2 箇所に書くと、片方だけ直したときにクエストが嘘の見込みを表示する。
import { SKILL_LEVEL_XP, XP_PER_KEY_RESULT, XP_PER_POST, XP_PER_ROADMAP_STEP } from './xp.ts';

/**
 * クエスト（次の一手）の算出。
 *
 * docs/GAME_DESIGN.md「クエスト」節の実装。各クエストは「何をするか」「なぜ今か」
 * 「増える XP の見込み」「編集するファイル」を必ず持つ。
 * 「なぜ今か」を必須にしているのは、納得できない指示は無視されるため
 * （XP を増やすことが目的になった時点でこの仕組みは壊れる）。
 */

/** 一度に見せるクエストの上限。これを超えると一覧が「やらないことリスト」になる。 */
export const MAX_QUESTS = 5;

/**
 * 「期限が近い」とみなす残日数。
 * goals.ts の at-risk 判定と同じ 30 日を使う。領域ごとに別の閾値を持つと
 * 「ロードマップは急ぎだが目標は急ぎでない」という説明できない差が生まれる。
 */
const DUE_SOON_DAYS = AT_RISK_WITHIN_DAYS;

/** 未解放の実績を「あと一歩」とみなす進捗。 */
const NEAR_ACHIEVEMENT_PROGRESS = 0.7;

/** 1 回の提示に含める「あと一歩の実績」の上限。メタな一手で枠を埋め尽くさないため。 */
const MAX_ACHIEVEMENT_QUESTS = 2;

/** 1 回の提示に含めるスキルクエストの上限。同時に伸ばせる数には限りがある。 */
const MAX_SKILL_QUESTS = 2;

/**
 * スキルレベルの上限（levels.yaml は 0-5 の 6 段階）。
 * 累積 XP 表の段数から導くので、表を伸ばせばここも追従する。
 */
const MAX_SKILL_LEVEL = SKILL_LEVEL_XP.length - 1;

export interface QuestInput {
  skills: SkillsModel;
  goals: GoalsModel;
  roadmap: RoadmapModel;
  blog: BlogModel;
  streaks: StreakInfo;
  achievements: readonly AchievementStatus[];
  /** 基準日（YYYY-MM-DD）。期限の判定を決定的にするため必ず渡す。 */
  today: string;
}

/** 緊急度の表示順。期限切れが近いものを上に出す。 */
const URGENCY_ORDER: Record<Quest['urgency'], number> = { now: 0, soon: 1, later: 2 };

/** レベルを 1 つ上げたときに増える XP。 */
function skillLevelUpXp(level: number): number {
  return (SKILL_LEVEL_XP[level + 1] ?? 0) - (SKILL_LEVEL_XP[level] ?? 0);
}

/** 0-1 を百分率の整数にする（表示用）。 */
function percent(ratio: number): number {
  return Math.round(ratio * 100);
}

/**
 * 期限が近い／遅れているマイルストーンの、残りステップを 1 つ進めるクエスト。
 *
 * 依存先が未完了のもの（blockers あり）は除く。着手しても進められないので
 * 「次の一手」にならず、並べておくと毎回同じ項目が残って一覧が読まれなくなる
 * （依存先自身が期限に近づけばそちらがクエストになる）。
 */
function milestoneQuests(roadmap: RoadmapModel, today: string): Quest[] {
  return roadmap.milestones
    .filter(
      (milestone) =>
        milestone.status !== 'done' &&
        milestone.stepsDone < milestone.stepsTotal &&
        milestone.blockers.length === 0 &&
        (milestone.overdue || daysBetween(today, milestone.due) <= DUE_SOON_DAYS),
    )
    .map((milestone) => {
      const daysLeft = daysBetween(today, milestone.due);
      const steps = `ステップは ${milestone.stepsDone}/${milestone.stepsTotal}`;
      return {
        id: `q-roadmap-${milestone.id}`,
        title: `${milestone.id} の残りステップを 1 つ終わらせる`,
        why: milestone.overdue
          ? `期限 ${milestone.due} を ${-daysLeft} 日超過、${steps}`
          : `期限 ${milestone.due} まで ${daysLeft} 日、${steps}`,
        xp: XP_PER_ROADMAP_STEP,
        target: 'data/roadmap.yaml',
        kind: 'roadmap' as const,
        urgency: milestone.overdue ? ('now' as const) : ('soon' as const),
      };
    });
}

/**
 * 進捗の遅い Key Result を進めるクエスト。
 *
 * 対象は goals.atRisk（期末が近いのに進捗が低く、まだ間に合う目標）。
 * 1 つの目標からは最も遅れている Key Result だけを出す（同じ目標で 2 件並べると
 * 枠を 1 つの目標で埋めてしまう）。
 */
function keyResultQuests(goals: GoalsModel): Quest[] {
  const quests: Quest[] = [];
  for (const goal of goals.atRisk) {
    const slowest = [...goal.key_results].sort(
      (a, b) => a.progress - b.progress || a.id.localeCompare(b.id),
    )[0];
    // 全 Key Result が満額なら進める先がない（status を done にするのは別の判断）。
    if (!slowest || slowest.progress >= 1) continue;

    const unit = slowest.unit ?? '';
    quests.push({
      id: `q-goal-${goal.id}`,
      title: `${goal.id} の ${slowest.id} を満額まで進める`,
      why: `期末まで ${goal.daysToQuarterEnd} 日で目標の進捗は ${percent(goal.progress)}%。${slowest.metric} は ${slowest.current}/${slowest.target}${unit}`,
      // この Key Result を満額にしたときに増える分。満額で 20 XP なので残りは 20 × (1 - 進捗)。
      xp: Math.round(XP_PER_KEY_RESULT * (1 - slowest.progress)),
      target: 'data/goals.yaml',
      kind: 'goal',
      urgency: 'soon',
    });
  }
  return quests;
}

/**
 * 目標レベルとの差が大きいスキルを 1 段上げるクエスト。
 * skills.gaps は gap 降順・現在レベル昇順（着手の費用対効果が高い順）なので先頭から取る。
 */
function skillGapQuests(skills: SkillsModel): Quest[] {
  return skills.gaps
    .filter((gap) => gap.skill.level < MAX_SKILL_LEVEL)
    .slice(0, MAX_SKILL_QUESTS)
    .map(({ skill, gap }) => {
      const next = skill.level + 1;
      const evidenceNote =
        next >= EVIDENCE_REQUIRED_LEVEL ? `。レベル ${next} には evidence が必要` : '';
      return {
        id: `q-skill-${skill.id}`,
        title: `${skill.name}（${skill.id}）をレベル ${next} に上げる`,
        why: `目標レベル ${skill.level + gap} に対して現在 ${skill.level}（差 ${gap}）${evidenceNote}`,
        xp: skillLevelUpXp(skill.level),
        target: 'data/skills.yaml',
        kind: 'skill' as const,
        urgency: 'later' as const,
      };
    });
}

/**
 * 途切れそうなストリークを繋ぐクエスト。
 *
 * 「今週あと 1 本書けば連続が続く」という形にする。
 * 「途切れた」ではなく「まだ間に合う」と伝えるのが、ストリークを使う唯一の正当な理由。
 * atRisk が複数あっても 1 件にまとめる（やることは「記事を 1 本公開する」1 つだから）。
 */
function streakQuests(streaks: StreakInfo, blog: BlogModel): Quest[] {
  if (streaks.atRisk.length === 0) return [];
  const since =
    blog.stats.daysSinceLastPost === null
      ? ''
      : `最終投稿から ${blog.stats.daysSinceLastPost} 日。`;
  return [
    {
      id: 'q-blog-streak',
      title: '今週のうちに記事を 1 本公開する',
      why: `${streaks.atRisk.join(' / ')}。${since}連続 ${streaks.blogWeeks} 週・${streaks.blogMonths} ヶ月は、今あと 1 本公開すれば途切れない`,
      xp: XP_PER_POST,
      target: 'blog/posts/',
      kind: 'blog',
      urgency: 'now',
    },
  ];
}

/**
 * データ品質のクエスト。
 *
 * xp を 0 にしているのは、警告の解消そのものに XP の規則が無いため
 * （目標を done に確定すれば完了ボーナスが付くが、done になると決まっていない数字を
 * 見込みに書くと「XP のために done にする」動機を作ってしまう）。
 * 領域ごとに 1 件へまとめる。警告 1 行ごとにクエストを立てると、
 * 警告が増えた日にクエスト一覧が警告一覧に化けて次の一手が見えなくなる。
 */
function hygieneQuests(skills: SkillsModel, goals: GoalsModel): Quest[] {
  const quests: Quest[] = [];

  const warnings = skills.warnings;
  const firstWarning = warnings[0];
  if (firstWarning) {
    const rest = warnings.length > 1 ? ` ほか ${warnings.length - 1} 件` : '';
    quests.push({
      id: 'q-hygiene-skills',
      title: `スキル棚卸しの警告 ${warnings.length} 件を解消する`,
      why: `${firstWarning}${rest}`,
      xp: 0,
      target: 'data/skills.yaml',
      kind: 'hygiene',
      urgency: 'soon',
    });
  }

  if (goals.stale.length > 0) {
    quests.push({
      id: 'q-hygiene-goals-stale',
      title: `期末を過ぎた目標 ${goals.stale.length} 件を done / dropped に確定させる`,
      why: `${goals.stale.map((goal) => goal.id).join(', ')} が期末を過ぎたまま未確定。振り返りを書いて決着させないと、達成率の分母が実態と合わなくなる`,
      xp: 0,
      target: 'data/goals.yaml',
      kind: 'hygiene',
      urgency: 'soon',
    });
  }

  return quests;
}

/**
 * あと一歩（進捗 0.7 以上）の未解放実績を取りに行くクエスト。
 * 進捗の高い順に MAX_ACHIEVEMENT_QUESTS 件まで。
 */
function achievementQuests(achievements: readonly AchievementStatus[]): Quest[] {
  return achievements
    .filter((status) => !status.unlocked && status.progress >= NEAR_ACHIEVEMENT_PROGRESS)
    .sort(
      (a, b) => b.progress - a.progress || a.definition.id.localeCompare(b.definition.id),
    )
    .slice(0, MAX_ACHIEVEMENT_QUESTS)
    .map((status) => {
      const hint = ACHIEVEMENT_QUEST_TARGETS.get(status.definition.id);
      return {
        id: `q-achievement-${status.definition.id}`,
        title: `実績「${status.definition.name}」を取りに行く`,
        why: `${status.definition.description}（${status.detail}）。解放で ${status.definition.xp} XP`,
        xp: status.definition.xp,
        // 定義側が編集先を持っているので ?? は型を絞るためのフォールバック。
        target: hint?.target ?? 'data/',
        kind: hint?.kind ?? ('hygiene' as const),
        urgency: 'later' as const,
      };
    });
}

/**
 * 同じ対象へのクエストを 1 件に絞る。
 *
 * id は対象（マイルストーン id・目標 id・スキル id など）から組み立てているので、
 * id の重複 = 同じ対象への二重提示。生成元が増えても「1 対象 = 1 クエスト」を保つための関門。
 * 先に生成されたものを残す（生成元の並び順が優先度）。
 */
function dedupeBySubject(quests: readonly Quest[]): Quest[] {
  const seen = new Set<string>();
  return quests.filter((quest) => {
    if (seen.has(quest.id)) return false;
    seen.add(quest.id);
    return true;
  });
}

/**
 * 次の一手を最大 MAX_QUESTS 件返す。
 *
 * 並びは urgency（now → soon → later）、同じ緊急度なら XP の降順。
 * 最後に id 昇順で同値を解消して出力を決定的にする（データが変わらなければ再ビルドで差分が出ない）。
 * 全てが順調なら 0 件になる。空の一覧は「やることがない」という正しい情報で、
 * 埋めるために意味のないクエストを作らない。
 */
export function computeQuests(input: QuestInput): Quest[] {
  const { skills, goals, roadmap, blog, streaks, achievements, today } = input;

  const candidates = [
    ...milestoneQuests(roadmap, today),
    ...streakQuests(streaks, blog),
    ...keyResultQuests(goals),
    ...hygieneQuests(skills, goals),
    ...skillGapQuests(skills),
    ...achievementQuests(achievements),
  ];

  return dedupeBySubject(candidates)
    .sort(
      (a, b) =>
        URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency] ||
        b.xp - a.xp ||
        a.id.localeCompare(b.id),
    )
    .slice(0, MAX_QUESTS);
}
