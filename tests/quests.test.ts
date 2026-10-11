import { describe, expect, it } from 'vitest';
import { ACHIEVEMENTS, evaluateAchievements } from '../src/lib/achievements.ts';
import { buildBlogModel, type BlogPost } from '../src/lib/blog.ts';
import type { AchievementStatus, Quest, StreakInfo } from '../src/lib/game-types.ts';
import { buildGoalsModel } from '../src/lib/goals.ts';
import { MAX_QUESTS, computeQuests, type QuestInput } from '../src/lib/quests.ts';
import { buildRoadmapModel } from '../src/lib/roadmap.ts';
import { buildSkillsModel } from '../src/lib/skills.ts';
import { goalsFileSchema } from '../src/schema/goals.ts';
import { roadmapFileSchema } from '../src/schema/roadmap.ts';
import { skillsFile } from '../src/schema/skills.ts';
import type { LevelDefinition } from '../src/schema/common.ts';

/**
 * 基準日は引数で渡して決定的にする。2026-Q4 の期末（2026-12-31）まで 11 日なので、
 * 「期末が近い目標」「期限が近いマイルストーン」を同じ基準日で作れる。
 */
const TODAY = '2026-12-20';
const NOW = new Date(`${TODAY}T00:00:00Z`);

const LEVELS: LevelDefinition[] = Array.from({ length: 6 }, (_, level) => ({
  level,
  name: `L${level}`,
  description: `レベル ${level} の定義`,
}));

function skills(entries: Array<Record<string, unknown>>) {
  const file = skillsFile.parse({
    owner: { name: 'テスト', role: 'エンジニア', updated: TODAY },
    categories: [{ id: 'infra', name: 'インフラ', weight: 1.0 }],
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

function post(date: string): BlogPost {
  return {
    fileName: `${date}-post.html`,
    sourcePath: `blog/posts/${date}-post.md`,
    slug: 'post',
    title: `記事 ${date}`,
    date,
    tags: ['test'],
    skills: ['s-settled'],
    summary: 'テスト用の記事の要約です',
    status: 'published',
    links: [],
    markdown: '本文',
    readingMinutes: 1,
    published: true,
  };
}

function streaks(overrides: Partial<StreakInfo> = {}): StreakInfo {
  return { blogWeeks: 0, blogMonths: 0, inventoryQuarters: 0, atRisk: [], ...overrides };
}

/** 完了したマイルストーン。クエストの生成元にならない「順調な」土台。 */
const SETTLED_MILESTONE = {
  id: 'm-settled',
  title: '終わったマイルストーン',
  track: 'infra',
  status: 'done',
  start: '2026-01-01',
  due: '2026-06-30',
  skills: ['s-settled'],
  outcome: '終わっている状態',
  steps: [{ description: '作業', done: true }],
};

/** 達成済みの目標。at-risk にも stale にもならない。 */
const SETTLED_GOAL = {
  id: 'g-settled',
  objective: '達成した目標',
  quarter: '2026-Q4',
  status: 'done',
  why: 'テストのため',
  skills: ['s-settled'],
  key_results: [{ id: 'kr-settled', description: '成果', metric: '件数', target: 1, current: 1 }],
};

/**
 * クエストが 1 件も出ない「全部順調」な状態。
 * 各テストはここから 1 つの生成元だけを有効にして、その生成元の振る舞いを確かめる。
 */
function quietInput(overrides: Partial<QuestInput> = {}): QuestInput {
  return {
    skills: skills([
      { id: 's-settled', name: '落ち着いたスキル', category: 'infra', level: 3, evidence: ['根拠'] },
    ]),
    goals: goals([SETTLED_GOAL]),
    roadmap: roadmap([SETTLED_MILESTONE]),
    blog: buildBlogModel([post('2026-12-01')], NOW),
    streaks: streaks(),
    achievements: [],
    today: TODAY,
    ...overrides,
  };
}

function idsOf(quests: readonly Quest[]): string[] {
  return quests.map((quest) => quest.id);
}

function questOf(quests: readonly Quest[], id: string): Quest {
  const found = quests.find((quest) => quest.id === id);
  if (!found) throw new Error(`クエスト ${id} が見つかりません（候補: ${idsOf(quests).join(', ')}）`);
  return found;
}

/** 進捗を指定した未解放の実績状態を作る（あと一歩のクエストの生成元）。 */
function nearAchievement(id: string, progress: number): AchievementStatus {
  const definition = ACHIEVEMENTS.find((candidate) => candidate.id === id);
  if (!definition) throw new Error(`実績 ${id} が定義されていません`);
  return { definition, unlocked: false, progress, detail: `進捗 ${progress}` };
}

describe('全部順調なデータ', () => {
  it('クエストが 0 件になり、例外を投げない', () => {
    expect(computeQuests(quietInput())).toEqual([]);
  });

  it('実績が全解放でも例外を投げない', () => {
    const input = quietInput();
    const achievements = evaluateAchievements({ ...input, historyCount: 100 }).map((status) => ({
      ...status,
      unlocked: true,
      progress: 1,
    }));
    expect(() => computeQuests({ ...input, achievements })).not.toThrow();
    expect(computeQuests({ ...input, achievements })).toEqual([]);
  });
});

describe('マイルストーンのクエスト', () => {
  const overdue = {
    id: 'm-late',
    title: '遅れているマイルストーン',
    track: 'infra',
    status: 'in_progress',
    start: '2026-09-01',
    due: '2026-11-01',
    skills: ['s-settled'],
    outcome: '終わっている状態',
    steps: [
      { description: '作業 1', done: true },
      { description: '作業 2', done: false },
      { description: '作業 3', done: false },
    ],
  };

  it('遅れているマイルストーンは now になり、超過日数を why に書く', () => {
    const quests = computeQuests(quietInput({ roadmap: roadmap([SETTLED_MILESTONE, overdue]) }));
    const quest = questOf(quests, 'q-roadmap-m-late');
    expect(quest.urgency).toBe('now');
    expect(quest.kind).toBe('roadmap');
    expect(quest.xp).toBe(15);
    expect(quest.target).toBe('data/roadmap.yaml');
    expect(quest.why).toContain('49 日超過');
    expect(quest.why).toContain('ステップは 1/3');
  });

  it('30 日以内に期限が来るものは soon、それより先は出さない', () => {
    const quests = computeQuests(
      quietInput({
        roadmap: roadmap([
          SETTLED_MILESTONE,
          { ...overdue, id: 'm-soon', due: '2026-12-30', start: '2026-12-01' },
          { ...overdue, id: 'm-far', due: '2027-06-30', start: '2027-01-01' },
        ]),
      }),
    );
    expect(idsOf(quests)).toEqual(['q-roadmap-m-soon']);
    expect(questOf(quests, 'q-roadmap-m-soon').urgency).toBe('soon');
    expect(questOf(quests, 'q-roadmap-m-soon').why).toContain('まで 10 日');
  });

  it('未完了の依存先があるマイルストーンは出さない（着手しても進められない）', () => {
    const quests = computeQuests(
      quietInput({
        roadmap: roadmap([
          SETTLED_MILESTONE,
          { ...overdue, id: 'm-blocker', due: '2027-06-30', start: '2027-01-01' },
          { ...overdue, id: 'm-waiting', due: '2026-12-25', start: '2026-12-01', depends_on: ['m-blocker'] },
        ]),
      }),
    );
    expect(idsOf(quests)).toEqual([]);
  });

  it('ステップが複数残っていてもクエストは 1 件（同じ対象を重複させない）', () => {
    const quests = computeQuests(
      quietInput({
        roadmap: roadmap([
          SETTLED_MILESTONE,
          { ...overdue, steps: overdue.steps.map((step) => ({ ...step, done: false })) },
        ]),
      }),
    );
    expect(idsOf(quests).filter((id) => id === 'q-roadmap-m-late')).toHaveLength(1);
  });

  it('ステップが全て終わっているマイルストーンは出さない', () => {
    const quests = computeQuests(
      quietInput({
        roadmap: roadmap([
          SETTLED_MILESTONE,
          { ...overdue, steps: overdue.steps.map((step) => ({ ...step, done: true })) },
        ]),
      }),
    );
    expect(idsOf(quests)).toEqual([]);
  });
});

describe('Key Result のクエスト', () => {
  const slowGoal = {
    id: 'g-slow',
    objective: '遅れている目標',
    quarter: '2026-Q4',
    status: 'in_progress',
    why: 'テストのため',
    skills: ['s-settled'],
    key_results: [
      { id: 'kr-behind', description: '遅れている成果', metric: '完了件数', target: 4, current: 0, unit: '件' },
      { id: 'kr-half', description: '半分の成果', metric: '週数', target: 2, current: 1 },
    ],
  };

  it('最も遅れている Key Result を 1 件だけ soon で出す', () => {
    const quests = computeQuests(quietInput({ goals: goals([SETTLED_GOAL, slowGoal]) }));
    expect(idsOf(quests)).toEqual(['q-goal-g-slow']);

    const quest = questOf(quests, 'q-goal-g-slow');
    expect(quest.urgency).toBe('soon');
    expect(quest.kind).toBe('goal');
    expect(quest.target).toBe('data/goals.yaml');
    expect(quest.title).toContain('kr-behind');
    // 20 × (1 - 0) = 20 XP（docs/GAME_DESIGN.md: Key Result 1 件は満額 20 XP）
    expect(quest.xp).toBe(20);
    expect(quest.why).toContain('期末まで 11 日');
    expect(quest.why).toContain('0/4件');
  });

  it('見込み XP は残りの進捗分だけを数える', () => {
    const quests = computeQuests(
      quietInput({
        goals: goals([
          SETTLED_GOAL,
          {
            ...slowGoal,
            key_results: [
              { id: 'kr-quarter', description: '四分の一の成果', metric: '週数', target: 4, current: 1 },
            ],
          },
        ]),
      }),
    );
    // 進捗 0.25 の Key Result を満額にすると 20 × (1 - 0.25) = 15 XP 増える
    expect(questOf(quests, 'q-goal-g-slow').xp).toBe(15);
  });

  it('期末が遠い目標は出さない', () => {
    const quests = computeQuests(
      quietInput({ goals: goals([SETTLED_GOAL, { ...slowGoal, quarter: '2027-Q4' }]) }),
    );
    expect(idsOf(quests)).toEqual([]);
  });
});

describe('スキルのクエスト', () => {
  it('ギャップの大きいスキルを later で出し、XP は累積表の差分になる', () => {
    const quests = computeQuests(
      quietInput({
        skills: skills([
          { id: 's-settled', name: '落ち着いたスキル', category: 'infra', level: 3, evidence: ['根拠'] },
          { id: 's-go', name: 'Go', category: 'infra', level: 1, target: 3 },
          { id: 's-rdb', name: 'RDB', category: 'infra', level: 2, target: 4 },
        ]),
      }),
    );

    expect(idsOf(quests).sort()).toEqual(['q-skill-s-go', 'q-skill-s-rdb']);
    const go = questOf(quests, 's-go'.replace(/^/, 'q-skill-'));
    expect(go.urgency).toBe('later');
    expect(go.kind).toBe('skill');
    expect(go.target).toBe('data/skills.yaml');
    expect(go.title).toContain('レベル 2 に上げる');
    // 累積 XP は 1 → 10、2 → 30 なので差分は 20
    expect(go.xp).toBe(20);
    // 2 → 30、3 → 70 なので差分は 40。レベル 3 以上は evidence が必要なことも伝える
    expect(questOf(quests, 'q-skill-s-rdb').xp).toBe(40);
    expect(questOf(quests, 'q-skill-s-rdb').why).toContain('evidence');
  });

  it('同時に出すスキルは 2 件まで', () => {
    const quests = computeQuests(
      quietInput({
        skills: skills(
          Array.from({ length: 5 }, (_, index) => ({
            id: `s-gap-${index + 1}`,
            name: `スキル ${index + 1}`,
            category: 'infra',
            level: 1,
            target: 4,
          })),
        ),
      }),
    );
    expect(quests.filter((quest) => quest.kind === 'skill')).toHaveLength(2);
  });

  it('レベル 5 のスキルは対象外（これ以上上げられない）', () => {
    const quests = computeQuests(
      quietInput({
        skills: skills([
          { id: 's-top', name: '最上位', category: 'infra', level: 5, target: 5, evidence: ['根拠'] },
        ]),
      }),
    );
    expect(quests.filter((quest) => quest.kind === 'skill')).toEqual([]);
  });
});

describe('ストリークのクエスト', () => {
  it('途切れそうなら now で「あと 1 本」を出す', () => {
    const quests = computeQuests(
      quietInput({
        streaks: streaks({ blogWeeks: 5, blogMonths: 3, atRisk: ['今週はまだ記事がありません'] }),
      }),
    );
    const quest = questOf(quests, 'q-blog-streak');
    expect(quest.urgency).toBe('now');
    expect(quest.kind).toBe('blog');
    expect(quest.xp).toBe(50);
    expect(quest.target).toBe('blog/posts/');
    expect(quest.title).toContain('1 本公開する');
    expect(quest.why).toContain('今週はまだ記事がありません');
    expect(quest.why).toContain('途切れない');
  });

  it('atRisk が複数あってもクエストは 1 件', () => {
    const quests = computeQuests(
      quietInput({ streaks: streaks({ atRisk: ['週が未達', '月が未達'] }) }),
    );
    expect(idsOf(quests)).toEqual(['q-blog-streak']);
  });
});

describe('データ品質のクエスト', () => {
  it('スキルの警告を hygiene / soon でまとめて 1 件にする', () => {
    const quests = computeQuests(
      quietInput({
        skills: skills([
          // レベル 3 で evidence 未記入 → 警告が 1 件
          { id: 's-no-evidence', name: '根拠なし', category: 'infra', level: 3 },
          // 最終利用が古い → 警告がもう 1 件
          { id: 's-rusty', name: '鈍った技術', category: 'infra', level: 1, last_used: '2024-01' },
        ]),
      }),
    );
    const quest = questOf(quests, 'q-hygiene-skills');
    expect(quest.kind).toBe('hygiene');
    expect(quest.urgency).toBe('soon');
    expect(quest.title).toContain('2 件');
    expect(quest.why).toContain('ほか 1 件');
    expect(quest.xp).toBe(0);
    expect(quest.target).toBe('data/skills.yaml');
  });

  it('期末を過ぎたまま未確定の目標を hygiene で出す', () => {
    const quests = computeQuests(
      quietInput({
        goals: goals([
          SETTLED_GOAL,
          {
            id: 'g-forgotten',
            objective: '放置された目標',
            quarter: '2026-Q2',
            status: 'in_progress',
            why: 'テストのため',
            skills: ['s-settled'],
            key_results: [{ id: 'kr-x', description: '成果', metric: '件数', target: 2, current: 1 }],
          },
        ]),
      }),
    );
    const quest = questOf(quests, 'q-hygiene-goals-stale');
    expect(quest.kind).toBe('hygiene');
    expect(quest.urgency).toBe('soon');
    expect(quest.why).toContain('g-forgotten');
    expect(quest.xp).toBe(0);
  });
});

describe('あと一歩の実績のクエスト', () => {
  it('進捗 0.7 以上の未解放実績を later で出す', () => {
    const quests = computeQuests(
      quietInput({ achievements: [nearAchievement('posts-ten', 0.8)] }),
    );
    const quest = questOf(quests, 'q-achievement-posts-ten');
    expect(quest.urgency).toBe('later');
    expect(quest.kind).toBe('blog');
    expect(quest.target).toBe('blog/posts/');
    expect(quest.xp).toBe(60);
    expect(quest.why).toContain('進捗 0.8');
  });

  it('進捗 0.7 未満と解放済みは出さない', () => {
    const quests = computeQuests(
      quietInput({
        achievements: [
          nearAchievement('posts-ten', 0.69),
          { ...nearAchievement('first-post', 1), unlocked: true },
        ],
      }),
    );
    expect(idsOf(quests)).toEqual([]);
  });

  it('出すのは進捗の高い 2 件まで', () => {
    const quests = computeQuests(
      quietInput({
        achievements: [
          nearAchievement('posts-ten', 0.7),
          nearAchievement('milestones-five', 0.8),
          nearAchievement('key-results-ten', 0.9),
        ],
      }),
    );
    expect(idsOf(quests).sort()).toEqual([
      'q-achievement-key-results-ten',
      'q-achievement-milestones-five',
    ]);
  });
});

describe('全体の並びと上限', () => {
  /** すべての生成元が同時に火を噴く状態。 */
  function busyInput(): QuestInput {
    return quietInput({
      skills: skills([
        { id: 's-no-evidence', name: '根拠なし', category: 'infra', level: 3 },
        { id: 's-go', name: 'Go', category: 'infra', level: 1, target: 4 },
        { id: 's-rdb', name: 'RDB', category: 'infra', level: 2, target: 4 },
      ]),
      goals: goals([
        SETTLED_GOAL,
        {
          id: 'g-slow',
          objective: '遅れている目標',
          quarter: '2026-Q4',
          status: 'in_progress',
          why: 'テストのため',
          skills: ['s-go'],
          key_results: [{ id: 'kr-behind', description: '成果', metric: '件数', target: 4, current: 0 }],
        },
        {
          id: 'g-forgotten',
          objective: '放置された目標',
          quarter: '2026-Q1',
          status: 'not_started',
          why: 'テストのため',
          skills: ['s-go'],
          key_results: [{ id: 'kr-y', description: '成果', metric: '件数', target: 2, current: 0 }],
        },
      ]),
      roadmap: roadmap([
        SETTLED_MILESTONE,
        {
          id: 'm-late',
          title: '遅れているマイルストーン',
          track: 'infra',
          status: 'in_progress',
          start: '2026-09-01',
          due: '2026-11-01',
          skills: ['s-go'],
          outcome: '終わっている状態',
          steps: [
            { description: '作業 1', done: true },
            { description: '作業 2', done: false },
          ],
        },
        {
          id: 'm-soon',
          title: '期限が近いマイルストーン',
          track: 'infra',
          status: 'in_progress',
          start: '2026-12-01',
          due: '2026-12-28',
          skills: ['s-go'],
          outcome: '終わっている状態',
          steps: [{ description: '作業 1', done: false }],
        },
      ]),
      streaks: streaks({ blogWeeks: 4, blogMonths: 2, atRisk: ['今週はまだ記事がありません'] }),
      achievements: [nearAchievement('posts-ten', 0.9), nearAchievement('milestones-five', 0.8)],
    });
  }

  it('最大 5 件に収まる', () => {
    const quests = computeQuests(busyInput());
    expect(MAX_QUESTS).toBe(5);
    expect(quests).toHaveLength(MAX_QUESTS);
  });

  it('緊急度の順序が守られ、同緊急度では XP の降順になる', () => {
    const quests = computeQuests(busyInput());
    const order = { now: 0, soon: 1, later: 2 } as const;
    for (const [index, quest] of quests.slice(1).entries()) {
      const previous = quests[index];
      if (!previous) throw new Error('前の要素が取得できません');
      const diff = order[quest.urgency] - order[previous.urgency];
      expect(diff, `${previous.id} → ${quest.id}`).toBeGreaterThanOrEqual(0);
      if (diff === 0) expect(previous.xp).toBeGreaterThanOrEqual(quest.xp);
    }
  });

  it('now のクエストが先頭に来る', () => {
    const quests = computeQuests(busyInput());
    // ストリーク（50 XP）が遅延マイルストーン（15 XP）より前に来る
    expect(idsOf(quests).slice(0, 2)).toEqual(['q-blog-streak', 'q-roadmap-m-late']);
  });

  it('同じ対象のクエストが重複しない', () => {
    const quests = computeQuests(busyInput());
    expect(new Set(idsOf(quests)).size).toBe(quests.length);
  });

  it('why と target が空文字にならない', () => {
    for (const quest of computeQuests(busyInput())) {
      expect(quest.title.trim().length, quest.id).toBeGreaterThan(0);
      expect(quest.why.trim().length, quest.id).toBeGreaterThan(0);
      expect(quest.target.trim().length, quest.id).toBeGreaterThan(0);
      expect(quest.xp, quest.id).toBeGreaterThanOrEqual(0);
    }
  });

  it('同じ入力なら同じ結果（決定的）', () => {
    expect(idsOf(computeQuests(busyInput()))).toEqual(idsOf(computeQuests(busyInput())));
  });
});
