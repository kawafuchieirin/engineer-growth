import { describe, expect, it } from 'vitest';
import {
  ACHIEVEMENTS,
  ACHIEVEMENT_QUEST_TARGETS,
  achievementXp,
  evaluateAchievements,
  type AchievementInput,
} from '../src/lib/achievements.ts';
import type { AchievementStatus, StreakInfo } from '../src/lib/game-types.ts';
import { buildBlogModel, type BlogPost } from '../src/lib/blog.ts';
import { buildGoalsModel } from '../src/lib/goals.ts';
import { buildRoadmapModel } from '../src/lib/roadmap.ts';
import { buildSkillsModel } from '../src/lib/skills.ts';
import { goalsFileSchema } from '../src/schema/goals.ts';
import { roadmapFileSchema } from '../src/schema/roadmap.ts';
import { skillsFile } from '../src/schema/skills.ts';
import { kebabId, type LevelDefinition } from '../src/schema/common.ts';

/**
 * 実データ（data/）には依存させない。基準日もここで固定し、
 * スキル・目標・ロードマップ・ブログを最小構成で組み立てて実績の判定だけを見る。
 */
const TODAY = '2026-10-11';
const NOW = new Date(`${TODAY}T00:00:00Z`);

const LEVELS: LevelDefinition[] = Array.from({ length: 6 }, (_, level) => ({
  level,
  name: `L${level}`,
  description: `レベル ${level} の定義`,
}));

function skills(entries: Array<Record<string, unknown>>, categories?: Array<Record<string, unknown>>) {
  const file = skillsFile.parse({
    owner: { name: 'テスト', role: 'エンジニア', updated: TODAY },
    categories: categories ?? [{ id: 'infra', name: 'インフラ', weight: 1.0 }],
    skills: entries,
  });
  return buildSkillsModel(file, LEVELS, NOW);
}

function goals(entries: Array<Record<string, unknown>>) {
  const file = goalsFileSchema.parse({
    horizon: { vision: 'テスト用のありたい姿', updated: TODAY },
    goals: entries,
  });
  return buildGoalsModel(file, TODAY);
}

function roadmap(milestones: Array<Record<string, unknown>>) {
  const file = roadmapFileSchema.parse({
    updated: TODAY,
    tracks: [{ id: 'infra', name: 'インフラ' }],
    milestones,
  });
  return buildRoadmapModel(file, TODAY);
}

function post(date: string, skillIds: string[] = ['s-one']): BlogPost {
  return {
    fileName: `${date}-post.html`,
    sourcePath: `blog/posts/${date}-post.md`,
    slug: 'post',
    title: `記事 ${date}`,
    date,
    tags: ['test'],
    skills: skillIds,
    summary: 'テスト用の記事の要約です',
    status: 'published',
    links: [],
    markdown: '本文',
    readingMinutes: 1,
    published: true,
  };
}

function blog(posts: BlogPost[]) {
  return buildBlogModel(posts, NOW);
}

function streaks(overrides: Partial<StreakInfo> = {}): StreakInfo {
  return { blogWeeks: 0, blogMonths: 0, inventoryQuarters: 0, atRisk: [], ...overrides };
}

/** 何も成していない状態。未解放側の表示（進捗と残り数）を確かめるための土台。 */
function emptyInput(): AchievementInput {
  return {
    skills: skills([
      { id: 's-one', name: 'スキル 1', category: 'infra', level: 1 },
      { id: 's-two', name: 'スキル 2', category: 'infra', level: 0 },
    ]),
    goals: goals([
      {
        id: 'g-one',
        objective: '何かを始める',
        quarter: '2026-Q4',
        status: 'not_started',
        why: 'テストのため',
        skills: ['s-one'],
        key_results: [
          { id: 'kr-one', description: '3 件やる', metric: '件数', target: 3, current: 0 },
        ],
      },
    ]),
    roadmap: roadmap([
      {
        id: 'm-one',
        title: '最初のマイルストーン',
        track: 'infra',
        status: 'planned',
        start: '2026-11-01',
        due: '2026-12-31',
        skills: ['s-one'],
        outcome: '何かが終わっている状態',
        steps: [{ description: '作業 1', done: false }],
      },
    ]),
    blog: blog([]),
    streaks: streaks(),
    historyCount: 0,
  };
}

/** 25 本の公開記事。日付を 1 週ずつずらして基準日以前に収める。 */
function manyPosts(count: number): BlogPost[] {
  const base = Date.UTC(2026, 0, 4);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(base + index * 7 * 86_400_000).toISOString().slice(0, 10);
    // 1 本だけ 3 スキルに紐付ける（横断する学びの実績の条件）。
    return post(date, index === 0 ? ['s-one', 's-two', 's-three'] : ['s-one']);
  });
}

/** 全ての実績条件を満たした状態。 */
function completeInput(): AchievementInput {
  const evidence = Array.from({ length: 5 }, (_, index) => `根拠 ${index + 1}`);
  const keyResults = (prefix: string) =>
    Array.from({ length: 5 }, (_, index) => ({
      id: `${prefix}-${index + 1}`,
      description: `成果 ${index + 1}`,
      metric: '件数',
      target: 2,
      current: 2,
    }));

  return {
    skills: skills([
      { id: 's-one', name: 'スキル 1', category: 'infra', level: 5, evidence },
      { id: 's-two', name: 'スキル 2', category: 'infra', level: 3, evidence },
    ]),
    goals: goals([
      {
        id: 'g-done-a',
        objective: '達成した目標 A',
        quarter: '2026-Q3',
        status: 'done',
        why: 'テストのため',
        skills: ['s-one'],
        key_results: keyResults('kr-a'),
      },
      {
        id: 'g-done-b',
        objective: '達成した目標 B',
        quarter: '2026-Q3',
        status: 'done',
        why: 'テストのため',
        skills: ['s-one'],
        key_results: keyResults('kr-b'),
      },
      {
        id: 'g-dropped',
        objective: '取りやめた目標',
        quarter: '2026-Q3',
        status: 'dropped',
        why: 'テストのため',
        skills: ['s-one'],
        key_results: [
          { id: 'kr-c-1', description: '成果', metric: '件数', target: 2, current: 0 },
        ],
        retrospective: 'やめた理由をここに書いた',
      },
    ]),
    roadmap: roadmap(
      Array.from({ length: 5 }, (_, index) => ({
        id: `m-${index + 1}`,
        title: `マイルストーン ${index + 1}`,
        track: 'infra',
        status: 'done',
        start: '2026-01-01',
        due: '2026-06-30',
        skills: ['s-one'],
        outcome: '終わっている状態',
        steps: [{ description: '作業', done: true }],
        // 2 件目だけ依存を持たせ、依存先ごと完了した鎖を作る。
        ...(index === 1 ? { depends_on: ['m-1'] } : {}),
      })),
    ),
    blog: blog(manyPosts(25)),
    streaks: streaks({ blogWeeks: 12, blogMonths: 6, inventoryQuarters: 4 }),
    historyCount: 10,
  };
}

function statusOf(statuses: AchievementStatus[], id: string): AchievementStatus {
  const found = statuses.find((status) => status.definition.id === id);
  if (!found) throw new Error(`実績 ${id} が見つかりません`);
  return found;
}

describe('実績の定義', () => {
  it('件数が 18-24 件の範囲にある', () => {
    expect(ACHIEVEMENTS.length).toBeGreaterThanOrEqual(18);
    expect(ACHIEVEMENTS.length).toBeLessThanOrEqual(24);
  });

  it('id が全件一意で kebab-case', () => {
    const ids = ACHIEVEMENTS.map((definition) => definition.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(kebabId.safeParse(id).success, `${id} が kebab-case ではありません`).toBe(true);
    }
  });

  it('xp が tier の目安に揃っている', () => {
    const expected = { bronze: 25, silver: 60, gold: 150, platinum: 400 } as const;
    for (const definition of ACHIEVEMENTS) {
      expect(definition.xp, definition.id).toBe(expected[definition.tier]);
    }
  });

  it('名前・説明・アイコンが空でない', () => {
    for (const definition of ACHIEVEMENTS) {
      expect(definition.name.length, definition.id).toBeGreaterThan(0);
      expect(definition.description.length, definition.id).toBeGreaterThan(0);
      expect(definition.icon.length, definition.id).toBeGreaterThan(0);
    }
  });

  it('全実績にクエスト用の編集先が定義されている', () => {
    for (const definition of ACHIEVEMENTS) {
      const hint = ACHIEVEMENT_QUEST_TARGETS.get(definition.id);
      expect(hint, definition.id).toBeDefined();
      expect(hint?.target.length, definition.id).toBeGreaterThan(0);
    }
  });

  it('全ての tier が使われている', () => {
    const tiers = new Set(ACHIEVEMENTS.map((definition) => definition.tier));
    expect([...tiers].sort()).toEqual(['bronze', 'gold', 'platinum', 'silver']);
  });
});

describe('evaluateAchievements', () => {
  it('全実績分の状態を返す', () => {
    expect(evaluateAchievements(emptyInput())).toHaveLength(ACHIEVEMENTS.length);
  });

  it('条件を満たすと unlocked: true になる', () => {
    const statuses = evaluateAchievements(completeInput());
    const locked = statuses.filter((status) => !status.unlocked);
    expect(locked.map((status) => status.definition.id)).toEqual([]);
    expect(statuses.every((status) => status.progress === 1)).toBe(true);
  });

  it('代表的な実績が個別の条件で解放される', () => {
    const statuses = evaluateAchievements(completeInput());
    for (const id of [
      'first-self-reliant-skill',
      'first-master-skill',
      'category-all-self-reliant',
      'evidence-ten',
      'quarter-clean-sweep',
      'key-results-ten',
      'retrospective-on-dropped',
      'dependency-chain-cleared',
      'posts-twenty-five',
      'blog-streak-six-months',
      'post-links-three-skills',
      'history-ten-records',
    ]) {
      expect(statusOf(statuses, id).unlocked, id).toBe(true);
    }
  });

  it('何も成していない状態ではほぼ全てが未解放で、進捗が 0-1 に収まる', () => {
    const statuses = evaluateAchievements(emptyInput());
    for (const status of statuses) {
      expect(status.progress, status.definition.id).toBeGreaterThanOrEqual(0);
      expect(status.progress, status.definition.id).toBeLessThanOrEqual(1);
      expect(status.detail.length, status.definition.id).toBeGreaterThan(0);
    }
    expect(statuses.filter((status) => status.unlocked)).toHaveLength(0);
  });

  it('未解放の detail に残り数が入る', () => {
    const input = emptyInput();
    const statuses = evaluateAchievements({ ...input, blog: blog(manyPosts(3)) });

    expect(statusOf(statuses, 'posts-ten').detail).toBe('3 / 10 記事（あと 7 記事）');
    expect(statusOf(statuses, 'posts-ten').progress).toBeCloseTo(0.3, 5);
    expect(statusOf(statuses, 'milestones-five').detail).toBe('0 / 5 件（あと 5 件）');
    expect(statusOf(statuses, 'history-ten-records').detail).toBe('0 / 10 件（あと 10 件）');
  });

  it('段階のない実績の進捗は 0 か 1 だけ', () => {
    const empty = statusOf(evaluateAchievements(emptyInput()), 'retrospective-on-dropped');
    const complete = statusOf(evaluateAchievements(completeInput()), 'retrospective-on-dropped');
    expect(empty.progress).toBe(0);
    expect(complete.progress).toBe(1);
  });

  it('平均レベルの進捗は小数で表示される', () => {
    const input = emptyInput();
    const status = statusOf(
      evaluateAchievements({
        ...input,
        skills: skills([
          { id: 's-one', name: 'スキル 1', category: 'infra', level: 2 },
          { id: 's-two', name: 'スキル 2', category: 'infra', level: 3, evidence: ['根拠'] },
        ]),
      }),
      'skill-average-three',
    );
    expect(status.unlocked).toBe(false);
    expect(status.detail).toBe('2.50 / 3.00（あと 0.50）');
  });

  it('空のカテゴリでは「面で取る」が解放されない', () => {
    const input = emptyInput();
    const statuses = evaluateAchievements({
      ...input,
      skills: skills(
        [{ id: 's-one', name: 'スキル 1', category: 'infra', level: 3, evidence: ['根拠'] }],
        [
          { id: 'infra', name: 'インフラ', weight: 1.0 },
          { id: 'empty', name: '空のカテゴリ', weight: 1.0 },
        ],
      ),
    });
    // 空カテゴリを 0/0 = 達成と数えないこと（数えると書いていないだけで解放される）。
    expect(statusOf(statuses, 'category-all-self-reliant').unlocked).toBe(true);
    expect(statusOf(statuses, 'category-all-self-reliant').detail).toContain('インフラ');
  });

  it('未解放は進捗を切り捨てて 1.00 と見せない', () => {
    const input = emptyInput();
    const statuses = evaluateAchievements({
      ...input,
      skills: skills(
        Array.from({ length: 300 }, (_, index) => ({
          id: `s-${index + 1}`,
          name: `スキル ${index + 1}`,
          category: 'infra',
          // 1 件だけレベル 0 にして「全スキルがレベル 1 以上」を未達にする。
          level: index === 0 ? 0 : 1,
        })),
      ),
    });
    const status = statusOf(statuses, 'no-untouched-skill');
    expect(status.unlocked).toBe(false);
    expect(status.progress).toBeLessThan(1);
    expect(status.progress).toBe(0.99);
  });

  it('historyCount を渡さなければ履歴の実績は 0 件として扱う', () => {
    const { historyCount: _ignored, ...withoutHistory } = completeInput();
    const status = statusOf(evaluateAchievements(withoutHistory), 'history-ten-records');
    expect(status.unlocked).toBe(false);
    expect(status.detail).toBe('0 / 10 件（あと 10 件）');
  });
});

describe('並び順', () => {
  const TIER_ORDER = { bronze: 0, silver: 1, gold: 2, platinum: 3 } as const;

  it('tier 昇順 → 解放済み優先 → 進捗降順', () => {
    // 解放済み・あと一歩・未着手が同じ tier に混ざる状態を作る。
    const statuses = evaluateAchievements({
      ...emptyInput(),
      skills: skills([
        { id: 's-one', name: 'スキル 1', category: 'infra', level: 3, evidence: ['根拠'] },
        { id: 's-two', name: 'スキル 2', category: 'infra', level: 1 },
      ]),
      blog: blog(manyPosts(8)),
      streaks: streaks({ blogWeeks: 3, blogMonths: 2 }),
    });

    for (const [index, status] of statuses.slice(1).entries()) {
      const previous = statuses[index];
      if (!previous) throw new Error('前の要素が取得できません');
      const tierDiff = TIER_ORDER[status.definition.tier] - TIER_ORDER[previous.definition.tier];
      expect(tierDiff, `${previous.definition.id} → ${status.definition.id}`).toBeGreaterThanOrEqual(0);
      if (tierDiff > 0) continue;
      // 同 tier 内では解放済みが先。
      expect(Number(previous.unlocked)).toBeGreaterThanOrEqual(Number(status.unlocked));
      if (previous.unlocked !== status.unlocked) continue;
      expect(previous.progress).toBeGreaterThanOrEqual(status.progress);
    }
  });

  it('同 tier では解放済みが未解放より前に来る', () => {
    const statuses = evaluateAchievements({
      ...emptyInput(),
      blog: blog(manyPosts(1)),
    });
    const bronze = statuses.filter((status) => status.definition.tier === 'bronze');
    const firstLocked = bronze.findIndex((status) => !status.unlocked);
    const lastUnlocked = bronze.map((status) => status.unlocked).lastIndexOf(true);
    expect(firstLocked).toBeGreaterThan(lastUnlocked);
  });

  it('データが同じなら並びも同じ（決定的）', () => {
    const ids = (statuses: AchievementStatus[]) => statuses.map((status) => status.definition.id);
    expect(ids(evaluateAchievements(emptyInput()))).toEqual(ids(evaluateAchievements(emptyInput())));
  });
});

describe('achievementXp', () => {
  it('解放済みのみ合計する', () => {
    const statuses = evaluateAchievements(emptyInput());
    expect(achievementXp(statuses)).toBe(0);

    const complete = evaluateAchievements(completeInput());
    const total = ACHIEVEMENTS.reduce((sum, definition) => sum + definition.xp, 0);
    expect(achievementXp(complete)).toBe(total);
  });

  it('一部が解放された状態では解放済みの xp だけを足す', () => {
    const statuses = evaluateAchievements({ ...emptyInput(), blog: blog(manyPosts(1)) });
    const unlocked = statuses.filter((status) => status.unlocked);
    expect(unlocked.length).toBeGreaterThan(0);
    expect(achievementXp(statuses)).toBe(
      unlocked.reduce((sum, status) => sum + status.definition.xp, 0),
    );
  });

  it('空配列でも 0 を返す', () => {
    expect(achievementXp([])).toBe(0);
  });
});
