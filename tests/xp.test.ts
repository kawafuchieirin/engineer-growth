import { describe, expect, it } from 'vitest';
import { buildBlogModel, parsePost, type BlogPost } from '../src/lib/blog.ts';
import { buildGoalsModel } from '../src/lib/goals.ts';
import { buildRoadmapModel } from '../src/lib/roadmap.ts';
import { buildSkillsModel } from '../src/lib/skills.ts';
import {
  SKILL_LEVEL_XP,
  blogXp,
  computeXp,
  describeLevel,
  goalsXp,
  levelForXp,
  roadmapXp,
  skillsXp,
  titleForLevel,
  xpForLevel,
} from '../src/lib/xp.ts';
import type { LevelDefinition } from '../src/schema/common.ts';
import { goalsFileSchema, type GoalsFile } from '../src/schema/goals.ts';
import { roadmapFileSchema, type RoadmapFile } from '../src/schema/roadmap.ts';
import { skillsFile, type Skill, type SkillsFile } from '../src/schema/skills.ts';

/** 実データに依存させない。XP の規則だけを固定する最小のフィクスチャを組む。 */
const NOW = new Date('2026-10-11T00:00:00Z');
const TODAY = '2026-10-11';

const levels: LevelDefinition[] = Array.from({ length: 6 }, (_, level) => ({
  level,
  name: `レベル${level}`,
  description: `レベル${level}の定義`,
}));

function skillsModel(
  skills: ReadonlyArray<Pick<Skill, 'id' | 'category' | 'level'>>,
  weights: { infra: number; soft: number } = { infra: 1, soft: 1 },
) {
  const file: SkillsFile = skillsFile.parse({
    owner: { name: 'テスト太郎', role: 'SRE', updated: TODAY },
    categories: [
      { id: 'infra', name: 'インフラ', weight: weights.infra },
      { id: 'soft', name: 'ソフト', weight: weights.soft },
    ],
    skills: skills.map((entry) => ({
      ...entry,
      name: entry.id,
      // レベル 3 以上は根拠を要求される（モデルの warning）。XP の検証には無関係なので常に付ける。
      evidence: ['テスト用の根拠'],
    })),
  });
  return buildSkillsModel(file, levels, NOW);
}

function goalsModel(goals: ReadonlyArray<Record<string, unknown>>) {
  const file: GoalsFile = goalsFileSchema.parse({
    horizon: { vision: 'テスト用のありたい姿', updated: TODAY },
    goals,
  });
  return buildGoalsModel(file, TODAY);
}

function goal(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'g-sample',
    objective: 'サンプルの目標',
    quarter: '2026-Q4',
    status: 'in_progress',
    why: 'テストのため',
    skills: ['infra-a'],
    key_results: [
      { id: 'kr-1', description: '何かを 4 件やる', metric: '完了件数', target: 4, current: 0 },
    ],
    ...overrides,
  };
}

function roadmapModel(milestones: ReadonlyArray<Record<string, unknown>>) {
  const file: RoadmapFile = roadmapFileSchema.parse({
    updated: TODAY,
    tracks: [{ id: 'infra', name: 'インフラ' }],
    milestones,
  });
  return buildRoadmapModel(file, TODAY);
}

function milestone(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'm-sample',
    title: 'サンプルのマイルストーン',
    track: 'infra',
    status: 'in_progress',
    start: '2026-10-01',
    due: '2026-12-31',
    skills: ['infra-a'],
    outcome: '達成状態の定義',
    steps: [
      { description: 'ステップ 1', done: false },
      { description: 'ステップ 2', done: false },
    ],
    ...overrides,
  };
}

function post(options: { date?: string; status?: string; origin?: 'posts' | 'drafts' } = {}): BlogPost {
  const { date = '2026-10-01', status = 'published', origin = 'posts' } = options;
  const raw = [
    '---',
    'title: テスト記事',
    `date: ${date}`,
    'tags: [terraform]',
    'skills: [infra-a]',
    'summary: テスト用の要約。十分な長さを持たせている。',
    `status: ${status}`,
    '---',
    '',
    '本文。',
    '',
  ].join('\n');
  return parsePost(raw, `${date}-test-post.md`, origin);
}

describe('xpForLevel', () => {
  it('GAME_DESIGN.md の仕様表と一致する', () => {
    expect(xpForLevel(1)).toBe(80);
    expect(xpForLevel(2)).toBe(226);
    expect(xpForLevel(3)).toBe(416);
    expect(xpForLevel(5)).toBe(894);
    expect(xpForLevel(10)).toBe(2530);
    expect(xpForLevel(20)).toBe(7155);
  });

  it('レベル 0 以下は 0 XP', () => {
    expect(xpForLevel(0)).toBe(0);
    expect(xpForLevel(-5)).toBe(0);
  });

  it('レベルが上がるほど必要 XP の増分が大きくなる（上の段ほど重い）', () => {
    const steps = Array.from({ length: 20 }, (_, index) => xpForLevel(index + 1) - xpForLevel(index));
    for (let index = 1; index < steps.length; index += 1) {
      expect(steps[index]).toBeGreaterThan(steps[index - 1] ?? 0);
    }
  });
});

describe('levelForXp', () => {
  it('境界値で 1 ずれない（必要 XP に 1 足りなければ前のレベル）', () => {
    for (let level = 1; level <= 30; level += 1) {
      expect(levelForXp(xpForLevel(level) - 1)).toBe(level - 1);
      expect(levelForXp(xpForLevel(level))).toBe(level);
    }
  });

  it('XP が 0 以下ならレベル 0', () => {
    expect(levelForXp(0)).toBe(0);
    expect(levelForXp(79)).toBe(0);
    expect(levelForXp(-100)).toBe(0);
  });

  it('XP が増えてもレベルが下がらない', () => {
    let previous = 0;
    for (let xp = 0; xp <= 8000; xp += 37) {
      const level = levelForXp(xp);
      expect(level).toBeGreaterThanOrEqual(previous);
      previous = level;
    }
  });
});

describe('describeLevel', () => {
  it('レベル到達直後の進捗は 0 で、次のレベルまでの残りが必要 XP 全量になる', () => {
    const info = describeLevel(xpForLevel(5));
    expect(info.level).toBe(5);
    expect(info.levelFloorXp).toBe(894);
    expect(info.nextLevelXp).toBe(xpForLevel(6));
    expect(info.ratio).toBe(0);
    expect(info.xpToNext).toBe(xpForLevel(6) - xpForLevel(5));
  });

  it('進捗は常に 0-1 に収まり、レベル帯の幅が 0 にならない', () => {
    for (let xp = 0; xp <= 10_000; xp += 13) {
      const info = describeLevel(xp);
      expect(info.ratio).toBeGreaterThanOrEqual(0);
      expect(info.ratio).toBeLessThanOrEqual(1);
      expect(info.nextLevelXp).toBeGreaterThan(info.levelFloorXp);
    }
  });

  it('XP 0 でもレベル 0 の情報を返す（ゼロ除算しない）', () => {
    const info = describeLevel(0);
    expect(info).toMatchObject({ level: 0, levelFloorXp: 0, nextLevelXp: 80, xpToNext: 80, ratio: 0 });
    expect(info.title).toBe('見習い');
  });

  it('レベル帯の中間では進捗がおおよそ半分になる', () => {
    const middle = Math.round((xpForLevel(3) + xpForLevel(4)) / 2);
    const info = describeLevel(middle);
    expect(info.level).toBe(3);
    expect(info.ratio).toBeCloseTo(0.5, 1);
  });
});

describe('titleForLevel', () => {
  it('GAME_DESIGN.md の称号表どおりに帯が切り替わる', () => {
    expect([0, 1, 2].map(titleForLevel)).toEqual(['見習い', '見習い', '見習い']);
    expect([3, 4].map(titleForLevel)).toEqual(['新人', '新人']);
    expect([5, 7].map(titleForLevel)).toEqual(['一人前', '一人前']);
    expect([8, 11].map(titleForLevel)).toEqual(['中堅', '中堅']);
    expect([12, 16].map(titleForLevel)).toEqual(['熟練', '熟練']);
    expect([17, 22].map(titleForLevel)).toEqual(['達人', '達人']);
    expect([23, 99].map(titleForLevel)).toEqual(['名匠', '名匠']);
  });
});

describe('skillsXp', () => {
  it('累積 XP の表どおりに合計する', () => {
    expect(SKILL_LEVEL_XP).toEqual([0, 10, 30, 70, 150, 300]);
    expect(skillsXp(skillsModel([{ id: 'infra-a', category: 'infra', level: 5 }]))).toBe(300);
    expect(
      skillsXp(
        skillsModel([
          { id: 'infra-a', category: 'infra', level: 3 },
          { id: 'soft-a', category: 'soft', level: 1 },
        ]),
      ),
    ).toBe(80);
  });

  it('全てレベル 0 なら 0 XP（スキルを並べただけでは増えない）', () => {
    expect(
      skillsXp(
        skillsModel([
          { id: 'infra-a', category: 'infra', level: 0 },
          { id: 'soft-a', category: 'soft', level: 0 },
        ]),
      ),
    ).toBe(0);
  });

  it('カテゴリの weight を変えても XP は変わらない（weight で盛れない）', () => {
    const skills = [
      { id: 'infra-a', category: 'infra', level: 4 },
      { id: 'soft-a', category: 'soft', level: 2 },
    ];
    const light = skillsModel(skills, { infra: 0.1, soft: 2.0 });
    const heavy = skillsModel(skills, { infra: 2.0, soft: 0.1 });

    expect(skillsXp(heavy)).toBe(skillsXp(light));
    // weight が実際にモデルへ効いている（= 無意味な比較ではない）ことも確かめる。
    expect(heavy.stats.weightedAverageLevel).not.toBe(light.stats.weightedAverageLevel);
  });
});

describe('goalsXp', () => {
  it('Key Result の進捗に比例して 1 件 20 XP まで与える', () => {
    const model = goalsModel([
      goal({
        key_results: [
          { id: 'kr-1', description: '半分', metric: '件', target: 4, current: 2 },
          { id: 'kr-2', description: '未着手', metric: '件', target: 4, current: 0 },
        ],
      }),
    ]);
    expect(goalsXp(model)).toBe(10);
  });

  it('current が target を超えても 1 件 20 XP で止まる', () => {
    const model = goalsModel([
      goal({
        key_results: [
          { id: 'kr-1', description: '超過', metric: '件', target: 4, current: 400 },
        ],
      }),
    ]);
    expect(goalsXp(model)).toBe(20);
  });

  it('status: done に完了ボーナス 100 XP を加える', () => {
    const model = goalsModel([
      goal({
        status: 'done',
        key_results: [
          { id: 'kr-1', description: '達成', metric: '件', target: 4, current: 4 },
        ],
      }),
    ]);
    expect(goalsXp(model)).toBe(120);
  });

  it('status: dropped は完了ボーナスを得ないが KR の進捗 XP は残る', () => {
    const keyResults = [
      { id: 'kr-1', description: '途中まで', metric: '件', target: 4, current: 3 },
    ];
    const dropped = goalsModel([goal({ status: 'dropped', key_results: keyResults })]);
    const inProgress = goalsModel([goal({ status: 'in_progress', key_results: keyResults })]);

    expect(goalsXp(dropped)).toBe(15);
    expect(goalsXp(dropped)).toBe(goalsXp(inProgress));
  });
});

describe('roadmapXp', () => {
  it('完了ステップ 1 つ 15 XP と done マイルストーンの 80 XP を合算する', () => {
    const model = roadmapModel([
      milestone({
        id: 'm-done',
        status: 'done',
        steps: [
          { description: 'ステップ 1', done: true },
          { description: 'ステップ 2', done: true },
        ],
      }),
      milestone({
        id: 'm-open',
        steps: [
          { description: 'ステップ 1', done: true },
          { description: 'ステップ 2', done: false },
        ],
      }),
    ]);
    expect(roadmapXp(model)).toBe(15 * 3 + 80);
  });

  it('何も完了していなければ 0 XP（計画を書くだけでは増えない）', () => {
    expect(roadmapXp(roadmapModel([milestone({ status: 'planned' })]))).toBe(0);
  });
});

describe('blogXp', () => {
  it('公開記事 1 本につき 50 XP、下書きは 0 XP', () => {
    const model = buildBlogModel(
      [
        post({ date: '2026-09-01' }),
        post({ date: '2026-09-15' }),
        post({ date: '2026-09-20', status: 'draft' }),
        post({ date: '2026-09-25', origin: 'drafts' }),
      ],
      NOW,
    );
    expect(model.posts).toHaveLength(2);
    expect(blogXp(model)).toBe(100);
  });

  it('記事が無ければ 0 XP', () => {
    expect(blogXp(buildBlogModel([], NOW))).toBe(0);
  });
});

describe('computeXp', () => {
  it('total は内訳の合計と厳密に一致する（履歴の検証が成立する前提）', () => {
    const xp = computeXp({
      skills: skillsModel([{ id: 'infra-a', category: 'infra', level: 3 }]),
      goals: goalsModel([
        goal({
          key_results: [{ id: 'kr-1', description: '1/3', metric: '件', target: 3, current: 1 }],
        }),
      ]),
      roadmap: roadmapModel([
        milestone({ steps: [{ description: 'ステップ 1', done: true }] }),
      ]),
      blog: buildBlogModel([post()], NOW),
      achievementXp: 25,
    });

    expect(xp.skills).toBe(70);
    // 20 × 1/3 = 6.666… を整数に丸める（領域ごとに丸めて total の厳密一致を保つ）。
    expect(xp.goals).toBe(7);
    expect(xp.roadmap).toBe(15);
    expect(xp.blog).toBe(50);
    expect(xp.achievements).toBe(25);
    expect(xp.total).toBe(xp.skills + xp.goals + xp.roadmap + xp.blog + xp.achievements);
    expect(Number.isInteger(xp.total)).toBe(true);
  });

  it('実績 XP は引数で受け取った分だけ加算する', () => {
    const input = {
      skills: skillsModel([{ id: 'infra-a', category: 'infra', level: 1 }]),
      goals: goalsModel([goal()]),
      roadmap: roadmapModel([milestone({ status: 'planned' })]),
      blog: buildBlogModel([], NOW),
    };
    expect(computeXp({ ...input, achievementXp: 0 }).total).toBe(10);
    expect(computeXp({ ...input, achievementXp: 40 }).total).toBe(50);
  });
});
