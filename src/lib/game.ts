import type { BlogModel } from './blog.ts';
import type { GoalsModel } from './goals.ts';
import type { RoadmapModel } from './roadmap.ts';
import type { SkillsModel } from './skills.ts';
import { achievementXp, evaluateAchievements } from './achievements.ts';
import { toJstDate } from './date.ts';
import { buildSnapshot, computeDeltas, loadHistory } from './history.ts';
import { computeQuests } from './quests.ts';
import { computeStreaks } from './streaks.ts';
import { computeXp, describeLevel } from './xp.ts';
import type { GameModel, Snapshot } from './game-types.ts';

export interface GameInput {
  skills: SkillsModel;
  goals: GoalsModel;
  roadmap: RoadmapModel;
  blog: BlogModel;
  now: Date;
}

/**
 * 4 領域のモデルからゲーム要素を導出する。
 *
 * この関数はファイルを 1 つだけ読む（data/history.yaml）。
 * 他の 4 領域は呼び出し側が既に読み込んでいるものを受け取るので、
 * build と validate で同じモデルを使い回せる（二重パースを避ける）。
 */
export async function loadGameModel(input: GameInput): Promise<GameModel> {
  const history = await loadHistory();
  return buildGameModel({ ...input, history });
}

/**
 * 履歴まで引数で受け取る純粋版。テストから決定的に呼べる。
 */
export function buildGameModel({
  skills,
  goals,
  roadmap,
  blog,
  now,
  history,
}: GameInput & { history: readonly Snapshot[] }): GameModel {
  const today = toJstDate(now);

  const streaks = computeStreaks({
    postDates: blog.posts.map((post) => post.date),
    snapshotDates: history.map((snapshot) => snapshot.date),
    today,
  });

  // 実績は XP に加算されるため、XP の算出より先に評価する必要がある。
  // historyCount は「履歴を N 回記録した」系の実績の判定に使う。
  const achievements = evaluateAchievements({
    skills,
    goals,
    roadmap,
    blog,
    streaks,
    historyCount: history.length,
  });
  const unlockedXp = achievementXp(achievements);
  const xp = computeXp({ skills, goals, roadmap, blog, achievementXp: unlockedXp });

  const level = describeLevel(xp.total);
  const quests = computeQuests({ skills, goals, roadmap, blog, streaks, achievements, today });

  // 現在値の組み立ては buildSnapshot に任せる。画面に出す値と
  // data/history.yaml に積む値が同じ関数から出ることを保証するため。
  const current = buildSnapshot({
    date: today,
    skills,
    goals,
    roadmap,
    blog,
    achievementXp: unlockedXp,
    achievements: achievements
      .filter((status) => status.unlocked)
      .map((status) => status.definition.id),
  });

  return {
    xp,
    level,
    streaks,
    achievements,
    quests,
    history,
    deltas: computeDeltas(history, current),
    current,
    today,
  };
}
