import type { BlogModel } from './blog.ts';
import type { AchievementDefinition, AchievementStatus, Quest, StreakInfo } from './game-types.ts';
import type { GoalsModel } from './goals.ts';
import type { RoadmapModel } from './roadmap.ts';
import { EVIDENCE_REQUIRED_LEVEL, STRENGTH_LEVEL, type SkillsModel } from './skills.ts';

/**
 * 実績（バッジ）の定義と評価。
 *
 * 定義（何を成したら解放されるか）は**コードに置く**。条件はロジックであってデータではなく、
 * YAML に出すと「条件を自分に合わせて書き換える」ことができてしまう。
 * 解放状態は data/ と blog/ から導出するだけで、保存もしない（docs/GAME_DESIGN.md の大原則）。
 *
 * 実績にするのは「何かを**成した**」ことだけ。「ログインした」「ファイルを開いた」のような
 * 実力と無関係なものは入れない（docs/GAME_DESIGN.md「この仕組みが壊れるとき」）。
 */

/** level 5（levels.yaml の「第一人者」）。最上段に到達したかの判定に使う。 */
const MASTER_LEVEL = 5;

/** 根拠（evidence）の記録を「習慣になった」とみなす件数。 */
const EVIDENCE_HABIT_COUNT = 10;

export interface AchievementInput {
  skills: SkillsModel;
  goals: GoalsModel;
  roadmap: RoadmapModel;
  blog: BlogModel;
  streaks: StreakInfo;
  /**
   * 履歴（data/history.yaml）の件数。
   * 未指定なら 0 件として扱う。履歴は実績の集計に必須ではないため任意にしてある
   * （集約側が履歴を読む前に実績を評価できるようにする）。
   */
  historyCount?: number;
}

/**
 * 条件判定の結果。
 *
 * 進捗と説明文を 1 箇所で作り、`unlocked` は「進捗が 1 に達したか」から導く。
 * 「条件を満たしたか」と「進捗」を別々に書くと、片方だけ直して
 * 「進捗 100% なのに未解放」という食い違いが生まれる。
 */
interface Measure {
  /** 0-1。段階のない実績は 0 か 1。 */
  readonly progress: number;
  /** 「3 / 10 記事（あと 7 記事）」のように、あと何が足りないかを書く。 */
  readonly detail: string;
}

interface AchievementRule {
  readonly definition: AchievementDefinition;
  /**
   * 「あと一歩の実績」をクエストにするときの編集先。
   * クエスト側が id から領域を推測しないで済むよう、条件の定義と同じ場所に置く。
   */
  readonly quest: { readonly kind: Quest['kind']; readonly target: string };
  readonly measure: (input: AchievementInput) => Measure;
}

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

/** 小数 2 桁に揃える。平均レベルのような連続値を表示・比較で安定させる。 */
function format2(value: number): string {
  return value.toFixed(2);
}

/**
 * しきい値に向かう進捗。件数系の実績はすべてこれで表す。
 *
 * 未達のときに「あと何個か」を detail に必ず入れる。未解放の実績も一覧に出すので、
 * 「条件を満たしていない」だけでは次の行動が決まらない。
 */
function towards(
  current: number,
  required: number,
  unit: string,
  format: (value: number) => string = String,
): Measure {
  const suffix = unit === '' ? '' : ` ${unit}`;
  if (current >= required) return { progress: 1, detail: `達成: ${format(current)}${suffix}` };
  return {
    // required は定義側の定数なので 0 にはならないが、0 除算で NaN が伝播するのは避ける。
    progress: required <= 0 ? 1 : clamp01(current / required),
    detail: `${format(current)} / ${format(required)}${suffix}（あと ${format(required - current)}${suffix}）`,
  };
}

/** 段階のない実績（成したか否かだけ）。進捗は 0 か 1 になる。 */
function achieved(ok: boolean, whenDone: string, whenPending: string): Measure {
  return ok ? { progress: 1, detail: whenDone } : { progress: 0, detail: whenPending };
}

/** 指定レベル以上のスキル数。 */
function skillsAtLeast(skills: SkillsModel, level: number): number {
  return skills.skills.filter((entry) => entry.level >= level).length;
}

/** 記録されている根拠（evidence）の総数。レベルの主張を裏づける量そのもの。 */
function evidenceCount(skills: SkillsModel): number {
  return skills.skills.reduce((sum, entry) => sum + (entry.evidence?.length ?? 0), 0);
}

/**
 * 「全スキルがレベル 3 以上」に最も近いカテゴリ。
 * 空のカテゴリは対象にしない（0 件を「全員が条件を満たした」と数えると
 * スキルを 1 つも書いていないカテゴリで実績が解放されてしまう）。
 */
function bestCategoryCoverage(
  skills: SkillsModel,
): { name: string; done: number; total: number } | undefined {
  const filled = skills.categories.filter((category) => category.skills.length > 0);
  if (filled.length === 0) return undefined;
  return filled
    .map((category) => ({
      name: category.name,
      done: category.skills.filter((entry) => entry.level >= EVIDENCE_REQUIRED_LEVEL).length,
      total: category.skills.length,
    }))
    .sort((a, b) => b.done / b.total - a.done / a.total || a.name.localeCompare(b.name))[0];
}

/** 満額（current >= target）まで届いた Key Result の数。 */
function keyResultsAchieved(goals: GoalsModel): number {
  return goals.goals.flatMap((goal) => goal.key_results).filter((kr) => kr.progress >= 1).length;
}

/**
 * 「その四半期の目標を全部達成した」に最も近い四半期。
 * 分母は dropped を除いた件数（goals.ts の達成率と同じ集合）。
 * やらないと決めた目標を未達として数えると、取りやめの判断が罰になる。
 */
function bestQuarterSweep(goals: GoalsModel): { quarter: string; done: number; total: number } | undefined {
  const counted = goals.quarters
    .map((group) => {
      const target = group.goals.filter((goal) => goal.status !== 'dropped');
      return {
        quarter: group.quarter,
        done: target.filter((goal) => goal.status === 'done').length,
        total: target.length,
      };
    })
    .filter((group) => group.total > 0);
  if (counted.length === 0) return undefined;
  return counted.sort((a, b) => b.done / b.total - a.done / a.total || a.quarter.localeCompare(b.quarter))[0];
}

/** 取りやめた目標に振り返りを書いたか。失敗から学んだことを称えるための判定。 */
function hasRetrospectiveOnDropped(goals: GoalsModel): boolean {
  return goals.goals.some((goal) => goal.status === 'dropped' && (goal.retrospective ?? '') !== '');
}

/**
 * 依存のあるマイルストーンを、依存先ごと完了させたか。
 * MilestoneView.blockers は done のとき常に空になるため、ここでは生の depends_on を見る。
 */
function hasClearedDependencyChain(roadmap: RoadmapModel): boolean {
  const doneIds = new Set(
    roadmap.milestones.filter((milestone) => milestone.status === 'done').map((milestone) => milestone.id),
  );
  return roadmap.milestones.some(
    (milestone) =>
      milestone.status === 'done' &&
      (milestone.depends_on ?? []).length > 0 &&
      (milestone.depends_on ?? []).every((id) => doneIds.has(id)),
  );
}

/** 1 本の公開記事が紐付けた最大スキル数。領域をまたいで書けたことの指標。 */
function maxSkillsPerPost(blog: BlogModel): number {
  return blog.posts.reduce((max, post) => Math.max(max, post.skills.length), 0);
}

/**
 * 実績の定義。
 *
 * **id は履歴（data/history.yaml）の `achievements` に保存される。**
 * 後から改名すると過去の記録と結び付かなくなり、「いつ解放したか」「期間中に何が増えたか」
 * という差分が壊れる（改名前の id は永久に「解放済みだが定義のない実績」になる）。
 * 名前や説明文は自由に直してよいが、id は一度決めたら変えない。
 * 不要になった実績は id を再利用せず、定義ごと削除する。
 *
 * xp は tier の目安（bronze 25 / silver 60 / gold 150 / platinum 400）に揃える。
 * 個別に盛ると「どの実績が重いか」が tier から読めなくなる。
 */
const RULES: readonly AchievementRule[] = [
  // --- スキル ---
  {
    definition: {
      id: 'first-self-reliant-skill',
      name: '自走の一歩',
      description: `レベル ${EVIDENCE_REQUIRED_LEVEL}（自走）のスキルを 1 つ持つ`,
      icon: '🌱',
      xp: 25,
      tier: 'bronze',
    },
    quest: { kind: 'skill', target: 'data/skills.yaml' },
    measure: ({ skills }) => towards(skillsAtLeast(skills, EVIDENCE_REQUIRED_LEVEL), 1, 'スキル'),
  },
  {
    definition: {
      id: 'first-leading-skill',
      name: '牽引する技術',
      description: `レベル ${STRENGTH_LEVEL}（牽引）のスキルを 1 つ持つ`,
      icon: '⚡',
      xp: 60,
      tier: 'silver',
    },
    quest: { kind: 'skill', target: 'data/skills.yaml' },
    measure: ({ skills }) => towards(skillsAtLeast(skills, STRENGTH_LEVEL), 1, 'スキル'),
  },
  {
    definition: {
      id: 'first-master-skill',
      name: '第一人者',
      description: `レベル ${MASTER_LEVEL}（第一人者）のスキルを 1 つ持つ`,
      icon: '👑',
      xp: 150,
      tier: 'gold',
    },
    quest: { kind: 'skill', target: 'data/skills.yaml' },
    measure: ({ skills }) => towards(skillsAtLeast(skills, MASTER_LEVEL), 1, 'スキル'),
  },
  {
    definition: {
      id: 'category-all-self-reliant',
      name: '面で取る',
      description: `1 つのカテゴリの全スキルがレベル ${EVIDENCE_REQUIRED_LEVEL} 以上`,
      icon: '🏛',
      xp: 150,
      tier: 'gold',
    },
    quest: { kind: 'skill', target: 'data/skills.yaml' },
    measure: ({ skills }) => {
      const best = bestCategoryCoverage(skills);
      if (!best) return { progress: 0, detail: 'スキルが登録されたカテゴリがありません' };
      const measured = towards(best.done, best.total, 'スキル');
      return { progress: measured.progress, detail: `${best.name}: ${measured.detail}` };
    },
  },
  {
    definition: {
      id: 'skill-average-three',
      name: '底上げ',
      description: '全スキルの平均レベルが 3.0 に到達',
      icon: '📈',
      xp: 150,
      tier: 'gold',
    },
    quest: { kind: 'skill', target: 'data/skills.yaml' },
    measure: ({ skills }) => towards(skills.stats.averageLevel, 3, '', format2),
  },
  {
    definition: {
      id: 'no-untouched-skill',
      name: '空白なし',
      description: '登録した全スキルがレベル 1 以上（未経験ゼロ）',
      icon: '🧭',
      xp: 60,
      tier: 'silver',
    },
    quest: { kind: 'skill', target: 'data/skills.yaml' },
    measure: ({ skills }) => towards(skillsAtLeast(skills, 1), skills.skills.length, 'スキル'),
  },
  {
    definition: {
      id: 'evidence-ten',
      name: '裏づけのある自己申告',
      description: `レベルの根拠（evidence）を ${EVIDENCE_HABIT_COUNT} 件以上記録`,
      icon: '📎',
      xp: 25,
      tier: 'bronze',
    },
    quest: { kind: 'skill', target: 'data/skills.yaml' },
    measure: ({ skills }) => towards(evidenceCount(skills), EVIDENCE_HABIT_COUNT, '件'),
  },

  // --- 目標 ---
  {
    definition: {
      id: 'first-goal-done',
      name: '最初の達成',
      description: '目標を 1 つ達成する（status: done）',
      icon: '🎯',
      xp: 25,
      tier: 'bronze',
    },
    quest: { kind: 'goal', target: 'data/goals.yaml' },
    measure: ({ goals }) => towards(goals.stats.all.done, 1, '件'),
  },
  {
    definition: {
      id: 'quarter-clean-sweep',
      name: '完走した四半期',
      description: 'ある四半期の目標を全て達成する（取りやめを除く）',
      icon: '🏆',
      xp: 400,
      tier: 'platinum',
    },
    quest: { kind: 'goal', target: 'data/goals.yaml' },
    measure: ({ goals }) => {
      const best = bestQuarterSweep(goals);
      if (!best) return { progress: 0, detail: '集計できる四半期がありません' };
      const measured = towards(best.done, best.total, '件');
      return { progress: measured.progress, detail: `${best.quarter}: ${measured.detail}` };
    },
  },
  {
    definition: {
      id: 'key-results-ten',
      name: '測って終わらせる',
      description: 'Key Result を 10 件達成する（current が target に到達）',
      icon: '📊',
      xp: 60,
      tier: 'silver',
    },
    quest: { kind: 'goal', target: 'data/goals.yaml' },
    measure: ({ goals }) => towards(keyResultsAchieved(goals), 10, '件'),
  },
  {
    definition: {
      id: 'retrospective-on-dropped',
      name: 'やめた理由を残す',
      description: '取りやめた目標（dropped）に振り返りを書く',
      icon: '🪞',
      xp: 60,
      tier: 'silver',
    },
    quest: { kind: 'goal', target: 'data/goals.yaml' },
    // 取りやめは失敗ではなく判断。その理由を残せたことを称える実績で、
    // 「やめたら負け」にしないための装置でもある。
    measure: ({ goals }) =>
      achieved(
        hasRetrospectiveOnDropped(goals),
        '取りやめた目標に retrospective を記録済み',
        '取りやめた目標に retrospective が未記入です',
      ),
  },

  // --- ロードマップ ---
  {
    definition: {
      id: 'first-milestone-done',
      name: '最初の旗',
      description: 'マイルストーンを 1 つ完了する',
      icon: '🚩',
      xp: 25,
      tier: 'bronze',
    },
    quest: { kind: 'roadmap', target: 'data/roadmap.yaml' },
    measure: ({ roadmap }) => towards(roadmap.stats.done, 1, '件'),
  },
  {
    definition: {
      id: 'milestones-five',
      name: '道は続く',
      description: 'マイルストーンを 5 つ完了する',
      icon: '🗺',
      xp: 60,
      tier: 'silver',
    },
    quest: { kind: 'roadmap', target: 'data/roadmap.yaml' },
    measure: ({ roadmap }) => towards(roadmap.stats.done, 5, '件'),
  },
  {
    definition: {
      id: 'dependency-chain-cleared',
      name: '順番に積む',
      description: '依存のあるマイルストーンを、依存先ごと順番に完了する',
      icon: '🔗',
      xp: 150,
      tier: 'gold',
    },
    quest: { kind: 'roadmap', target: 'data/roadmap.yaml' },
    measure: ({ roadmap }) =>
      achieved(
        hasClearedDependencyChain(roadmap),
        'depends_on を持つマイルストーンを依存先ごと完了済み',
        'depends_on を持つマイルストーンの完了がまだありません',
      ),
  },

  // --- ブログ ---
  {
    definition: {
      id: 'first-post',
      name: '書いて出した',
      description: '記事を 1 本公開する',
      icon: '📝',
      xp: 25,
      tier: 'bronze',
    },
    quest: { kind: 'blog', target: 'blog/posts/' },
    measure: ({ blog }) => towards(blog.posts.length, 1, '記事'),
  },
  {
    definition: {
      id: 'posts-ten',
      name: '二桁の蓄積',
      description: '記事を 10 本公開する',
      icon: '📚',
      xp: 60,
      tier: 'silver',
    },
    quest: { kind: 'blog', target: 'blog/posts/' },
    measure: ({ blog }) => towards(blog.posts.length, 10, '記事'),
  },
  {
    definition: {
      id: 'posts-twenty-five',
      name: '書き続けた人',
      description: '記事を 25 本公開する',
      icon: '📖',
      xp: 150,
      tier: 'gold',
    },
    quest: { kind: 'blog', target: 'blog/posts/' },
    measure: ({ blog }) => towards(blog.posts.length, 25, '記事'),
  },
  {
    definition: {
      id: 'blog-streak-four-weeks',
      name: '1 ヶ月の習慣',
      description: '4 週連続で記事を公開する',
      icon: '🔥',
      xp: 60,
      tier: 'silver',
    },
    quest: { kind: 'blog', target: 'blog/posts/' },
    measure: ({ streaks }) => towards(streaks.blogWeeks, 4, '週'),
  },
  {
    definition: {
      id: 'blog-streak-twelve-weeks',
      name: '一四半期の習慣',
      description: '12 週連続で記事を公開する',
      icon: '🌋',
      xp: 150,
      tier: 'gold',
    },
    quest: { kind: 'blog', target: 'blog/posts/' },
    measure: ({ streaks }) => towards(streaks.blogWeeks, 12, '週'),
  },
  {
    definition: {
      id: 'blog-streak-six-months',
      name: '半年の習慣',
      description: '6 ヶ月連続で記事を公開する',
      icon: '🗿',
      xp: 400,
      tier: 'platinum',
    },
    quest: { kind: 'blog', target: 'blog/posts/' },
    measure: ({ streaks }) => towards(streaks.blogMonths, 6, 'ヶ月'),
  },
  {
    definition: {
      id: 'post-links-three-skills',
      name: '横断する学び',
      description: '1 本の記事を 3 つ以上のスキルに紐付ける',
      icon: '🧩',
      xp: 25,
      tier: 'bronze',
    },
    quest: { kind: 'blog', target: 'blog/posts/' },
    measure: ({ blog }) => towards(maxSkillsPerPost(blog), 3, 'スキル'),
  },

  // --- 継続 ---
  {
    definition: {
      id: 'inventory-four-quarters',
      name: '棚卸しを欠かさない',
      description: '4 四半期連続でスキルの棚卸しを記録する',
      icon: '🧾',
      xp: 150,
      tier: 'gold',
    },
    quest: { kind: 'hygiene', target: 'data/skills.yaml' },
    measure: ({ streaks }) => towards(streaks.inventoryQuarters, 4, '四半期'),
  },
  {
    definition: {
      id: 'history-ten-records',
      name: '記録が語る',
      description: '成長の記録（スナップショット）を 10 回積む',
      icon: '📓',
      xp: 60,
      tier: 'silver',
    },
    quest: { kind: 'hygiene', target: 'data/history.yaml' },
    measure: ({ historyCount }) => towards(historyCount ?? 0, 10, '件'),
  },
];

export const ACHIEVEMENTS: readonly AchievementDefinition[] = RULES.map((rule) => rule.definition);

/**
 * 実績ごとの「どのファイルを編集すれば前進するか」。
 * クエストが id の文字列から領域を推測しないで済むよう、条件の定義と同じ場所から公開する。
 */
export const ACHIEVEMENT_QUEST_TARGETS: ReadonlyMap<string, { kind: Quest['kind']; target: string }> =
  new Map(RULES.map((rule) => [rule.definition.id, rule.quest]));

/** 表示順を決めるための tier の重み。 */
const TIER_ORDER: Record<AchievementDefinition['tier'], number> = {
  bronze: 0,
  silver: 1,
  gold: 2,
  platinum: 3,
};

/**
 * 並び順: tier 昇順 → 解放済みを先 → 進捗の降順 → id 昇順。
 *
 * tier を昇順にするのは、手が届く範囲を上に置くため（platinum を先頭に並べても
 * 「遠すぎて関係ない」と読み飛ばされる）。同じ tier では解放済みを先に置いて
 * 積み上げたものを見せ、その次を進捗の降順にすることで「あと一歩」が
 * 未解放の先頭に来る。最後の id 昇順は出力を決定的にするための同値解消
 * （データが変わらなければ再ビルドで差分が出てはいけない）。
 */
function compareStatuses(a: AchievementStatus, b: AchievementStatus): number {
  return (
    TIER_ORDER[a.definition.tier] - TIER_ORDER[b.definition.tier] ||
    Number(b.unlocked) - Number(a.unlocked) ||
    b.progress - a.progress ||
    a.definition.id.localeCompare(b.definition.id)
  );
}

/**
 * 全実績を評価する。
 *
 * 判定は定義配列が持つ `measure`（個別の純粋関数）に委ねる。評価側で if を並べると
 * 定義と条件が別々の場所に散り、実績を 1 つ足すたびに 2 箇所を直すことになる。
 */
export function evaluateAchievements(input: AchievementInput): AchievementStatus[] {
  return RULES.map((rule) => {
    const measured = rule.measure(input);
    const unlocked = measured.progress >= 1;
    return {
      definition: rule.definition,
      unlocked,
      // 未解放を 1.00 と見せないため切り捨てる（99.6% が「100%なのに未解放」に見えるのを防ぐ）。
      progress: unlocked ? 1 : Math.floor(clamp01(measured.progress) * 100) / 100,
      detail: measured.detail,
    };
  }).sort(compareStatuses);
}

/** 解放済み実績の XP 合計。未解放は 0 として数えない（成していないものに XP は付かない）。 */
export function achievementXp(statuses: readonly AchievementStatus[]): number {
  return statuses
    .filter((status) => status.unlocked)
    .reduce((sum, status) => sum + status.definition.xp, 0);
}
