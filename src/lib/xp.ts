/**
 * XP とプレイヤーレベルの計算。
 *
 * 計算規則の正は docs/GAME_DESIGN.md。この実装はそこに書かれた表と式をそのまま写すだけで、
 * 独自の係数を持たない（数値を変えるときは先に GAME_DESIGN.md を直す）。
 *
 * XP は data/ と blog/ から機械的に導出するだけで、XP を直接書く場所を作らない。
 * そのためここにある関数はすべて検証済みモデルを入力に取る純粋関数であり、I/O をしない。
 */

import type { BlogModel } from './blog.ts';
import type { LevelInfo, XpBreakdown } from './game-types.ts';
import { keyResultProgress, type GoalsModel } from './goals.ts';
import type { RoadmapModel } from './roadmap.ts';
import type { SkillsModel } from './skills.ts';

/**
 * スキルレベルごとの累積 XP（GAME_DESIGN.md の表）。
 * 上の段ほど重いのは「3 から 4」の価値が「0 から 1」より大きいという実感に合わせるため。
 * 添字がレベル（0-5）に一致するので skillLevel の範囲とそのまま対応する。
 */
export const SKILL_LEVEL_XP: readonly number[] = [0, 10, 30, 70, 150, 300];

/** Key Result 1 件を満額まで進めたときの XP。 */
export const XP_PER_KEY_RESULT = 20;
/** status: done の目標の完了ボーナス。dropped には与えない。 */
export const XP_GOAL_DONE_BONUS = 100;
/** 完了したロードマップのステップ 1 つあたりの XP。 */
export const XP_PER_ROADMAP_STEP = 15;
/** status: done のマイルストーンの完了ボーナス。 */
export const XP_MILESTONE_DONE_BONUS = 80;
/** 公開記事 1 本あたりの XP。下書きは 0（書き上げて出すまでが 1 本）。 */
export const XP_PER_POST = 50;

/**
 * レベル帯と称号（GAME_DESIGN.md の表）。
 * `from` 以上で、次の帯の `from` 未満。最後の帯が上限なしを受け持つ。
 */
const TITLES: ReadonlyArray<{ from: number; title: string }> = [
  { from: 0, title: '見習い' },
  { from: 3, title: '新人' },
  { from: 5, title: '一人前' },
  { from: 8, title: '中堅' },
  { from: 12, title: '熟練' },
  { from: 17, title: '達人' },
  { from: 23, title: '名匠' },
];

/**
 * levelForXp の探索上限。レベルに上限は設けていないが、
 * xpForLevel が単調増加でなくなるなどの異常時に無限ループしないためのガード。
 * この値は到達しうる上限ではなく異常検出の線（level 1000 = 約 253 万 XP ≒ 記事 5 万本）。
 */
const LEVEL_SEARCH_LIMIT = 1000;

/**
 * XP は整数で扱う。
 *
 * Key Result の進捗 XP は `20 × 0.3333…` のような小数になるため、領域ごとに整数へ丸める。
 * 丸めを領域ごとにしておくと「total = 内訳の合計」が浮動小数の誤差なしに厳密に成り立ち、
 * data/history.yaml のスキーマ検証（内訳と合計の一致）でデータの腐敗を検出できる。
 */
function toXp(value: number): number {
  return Math.round(value);
}

/**
 * スキル XP = 全スキルの累積 XP の合計。
 *
 * カテゴリの `weight` は掛けない。weight は自分で動かせる値なので、掛けると
 * スライダーを動かすだけで XP が増えてしまう（GAME_DESIGN.md「大原則」）。
 */
export function skillsXp(skills: SkillsModel): number {
  return toXp(
    skills.skills.reduce((sum, skill) => sum + (SKILL_LEVEL_XP[skill.level] ?? 0), 0),
  );
}

/**
 * 目標 XP = Key Result の進捗分 + done の完了ボーナス。
 *
 * dropped には完了ボーナスを与えないが KR の進捗 XP は残す。
 * 取りやめた目標でも、そこまでに動いた分の労力は実在するため。
 */
export function goalsXp(goals: GoalsModel): number {
  let total = 0;
  for (const goal of goals.goals) {
    for (const keyResult of goal.key_results) {
      // keyResultProgress が min(current / target, 1) を担保するので current > target でも頭打ちになる。
      total += XP_PER_KEY_RESULT * keyResultProgress(keyResult);
    }
    if (goal.status === 'done') total += XP_GOAL_DONE_BONUS;
  }
  return toXp(total);
}

/** ロードマップ XP = 完了ステップ数 × 15 + done マイルストーンのボーナス。 */
export function roadmapXp(roadmap: RoadmapModel): number {
  let total = 0;
  for (const milestone of roadmap.milestones) {
    total += XP_PER_ROADMAP_STEP * milestone.stepsDone;
    if (milestone.status === 'done') total += XP_MILESTONE_DONE_BONUS;
  }
  return toXp(total);
}

/** ブログ XP = 公開記事数 × 50。`posts` は公開記事のみという BlogModel の契約に依存する。 */
export function blogXp(blog: BlogModel): number {
  return toXp(XP_PER_POST * blog.posts.length);
}

/**
 * レベル n に到達するために必要な累計 XP。`round(80 * n ** 1.5)`、n <= 0 は 0。
 * 指数ではなく 1.5 乗なのは、後半で「何をしても上がらない」状態にしないため。
 */
export function xpForLevel(level: number): number {
  if (!Number.isFinite(level) || level <= 0) return 0;
  return Math.round(80 * level ** 1.5);
}

/**
 * 累計 XP に対応するレベル。
 *
 * xpForLevel の逆関数を閉じた式で解かず、下から順に積み上げて求める。
 * `round` が入っているため逆関数は境界で 1 ずれることがあり、
 * 「必要 XP を満たしているのにレベルが上がらない」という最も不信を招く壊れ方をする。
 */
export function levelForXp(totalXp: number): number {
  if (!Number.isFinite(totalXp) || totalXp <= 0) return 0;
  let level = 0;
  while (level < LEVEL_SEARCH_LIMIT && xpForLevel(level + 1) <= totalXp) {
    level += 1;
  }
  return level;
}

/** レベル帯に対応する称号。 */
export function titleForLevel(level: number): string {
  let title = TITLES[0]?.title ?? '見習い';
  for (const band of TITLES) {
    if (level >= band.from) title = band.title;
  }
  return title;
}

/**
 * 累計 XP から現在のレベルと次のレベルまでの距離を求める。
 *
 * xpForLevel は単調増加で隣接レベルの差が必ず 80 以上あるため
 * `nextLevelXp - levelFloorXp` が 0 になることはないが、
 * 進捗バーのゼロ除算は値が壊れていると気付けない形で表示を壊すので明示的に守る。
 */
export function describeLevel(totalXp: number): LevelInfo {
  const total = Number.isFinite(totalXp) ? Math.max(0, totalXp) : 0;
  const level = levelForXp(total);
  const levelFloorXp = xpForLevel(level);
  const nextLevelXp = xpForLevel(level + 1);
  const span = nextLevelXp - levelFloorXp;

  return {
    level,
    title: titleForLevel(level),
    totalXp: total,
    levelFloorXp,
    nextLevelXp,
    xpToNext: Math.max(0, nextLevelXp - total),
    ratio: span <= 0 ? 0 : Math.min(1, Math.max(0, (total - levelFloorXp) / span)),
  };
}

/**
 * 4 領域と実績の XP をまとめる。
 *
 * `achievementXp` を引数で受けるのは、実績の判定（src/lib/achievements.ts）に
 * ここから依存しないため。XP の計算側が実績の条件を知る必要はなく、
 * 合計だけを渡してもらえば済む。
 */
export function computeXp(input: {
  skills: SkillsModel;
  goals: GoalsModel;
  roadmap: RoadmapModel;
  blog: BlogModel;
  achievementXp: number;
}): XpBreakdown {
  const skills = skillsXp(input.skills);
  const goals = goalsXp(input.goals);
  const roadmap = roadmapXp(input.roadmap);
  const blog = blogXp(input.blog);
  const achievements = toXp(Math.max(0, input.achievementXp));

  return {
    skills,
    goals,
    roadmap,
    blog,
    achievements,
    total: skills + goals + roadmap + blog + achievements,
  };
}
