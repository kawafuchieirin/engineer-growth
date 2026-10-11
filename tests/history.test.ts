import { parse as parseYaml } from 'yaml';
import { describe, expect, it } from 'vitest';
import type { Snapshot } from '../src/lib/game-types.ts';
import {
  HISTORY_HEADER,
  RECENT_DAYS,
  computeDeltas,
  formatHistoryYaml,
  historyPath,
  pickBaseline,
  upsertSnapshot,
} from '../src/lib/history.ts';
import { historyFileSchema, snapshotSchema } from '../src/schema/history.ts';

/** 差分の検証に必要な値だけを持つスナップショット。XP の内訳は total と一致させる。 */
function snapshot(overrides: Partial<Snapshot> & Pick<Snapshot, 'date'>): Snapshot {
  const skills = overrides.xp?.skills ?? 0;
  return {
    xp: {
      skills,
      goals: 0,
      roadmap: 0,
      blog: 0,
      achievements: 0,
      total: skills,
      ...overrides.xp,
    },
    level: 0,
    skillAverage: 0,
    skillCount: 10,
    posts: 0,
    milestonesDone: 0,
    goalsDone: 0,
    achievements: [],
    ...overrides,
  };
}

/** 任意の XP 合計を持つスナップショット（内訳は skills に寄せる）。 */
function at(date: string, total: number, extra: Partial<Snapshot> = {}): Snapshot {
  return snapshot({
    date,
    xp: { skills: total, goals: 0, roadmap: 0, blog: 0, achievements: 0, total },
    level: 1,
    ...extra,
  });
}

const CURRENT = at('2026-10-11', 1000, {
  level: 5,
  skillAverage: 2.95,
  posts: 10,
  milestonesDone: 3,
  goalsDone: 2,
  achievements: ['first-post', 'ten-posts'],
});

describe('historyPath', () => {
  it('data/history.yaml を指す（paths.ts を変えずに data から組み立てている）', () => {
    expect(historyPath.endsWith('/data/history.yaml')).toBe(true);
  });
});

describe('computeDeltas', () => {
  it('履歴が空なら差分を返さない（嘘の 0 を見せない）', () => {
    expect(computeDeltas([], CURRENT)).toEqual([]);
  });

  it('履歴が 1 件なら「前回の記録から」だけを返す（同じ比較を 2 行並べない）', () => {
    const deltas = computeDeltas([at('2026-09-20', 400)], CURRENT);
    expect(deltas).toHaveLength(1);
    expect(deltas[0]?.label).toBe('前回の記録から');
    expect(deltas[0]?.fromDate).toBe('2026-09-20');
    expect(deltas[0]?.days).toBe(21);
    expect(deltas[0]?.xp).toBe(600);
  });

  it(`${RECENT_DAYS} 日以上前の記録が無ければ「直近 ${RECENT_DAYS} 日」を含めない`, () => {
    const deltas = computeDeltas([at('2026-09-20', 400), at('2026-10-01', 700)], CURRENT);
    expect(deltas.map((delta) => delta.label)).toEqual(['前回の記録から', '始めてから']);
    expect(deltas.map((delta) => delta.fromDate)).toEqual(['2026-10-01', '2026-09-20']);
  });

  it('3 つの期間が揃えば「前回の記録から」「直近 90 日」「始めてから」を返す', () => {
    const deltas = computeDeltas(
      [at('2026-01-01', 100), at('2026-06-01', 300), at('2026-09-20', 400)],
      CURRENT,
    );
    expect(deltas.map((delta) => delta.label)).toEqual([
      '前回の記録から',
      `直近 ${RECENT_DAYS} 日`,
      '始めてから',
    ]);
    expect(deltas.map((delta) => delta.fromDate)).toEqual([
      '2026-09-20',
      '2026-06-01',
      '2026-01-01',
    ]);
    expect(deltas.map((delta) => delta.xp)).toEqual([600, 700, 900]);
  });

  it('当日の記録は比較元にしない（自分自身との差で 0 を並べない）', () => {
    const deltas = computeDeltas([at('2026-09-20', 400), at('2026-10-11', 980)], CURRENT);
    expect(deltas).toHaveLength(1);
    expect(deltas[0]?.fromDate).toBe('2026-09-20');
  });

  it('当日の記録しか無ければ差分を返さない', () => {
    expect(computeDeltas([at('2026-10-11', 980)], CURRENT)).toEqual([]);
  });

  it('期間中に解放された実績だけを拾い、平均レベルの差は小数第 2 位に丸める', () => {
    const [delta] = computeDeltas(
      [at('2026-09-20', 400, { skillAverage: 2.6, achievements: ['first-post'] })],
      CURRENT,
    );
    expect(delta?.newAchievements).toEqual(['ten-posts']);
    expect(delta?.skillAverage).toBe(0.35);
    expect(delta?.level).toBe(4);
    expect(delta?.posts).toBe(10);
    expect(delta?.milestonesDone).toBe(3);
    expect(delta?.goalsDone).toBe(2);
  });
});

describe('pickBaseline', () => {
  it('指定日数以上前で最も新しい記録を選ぶ', () => {
    const history = [at('2026-01-01', 100), at('2026-06-01', 300), at('2026-10-01', 700)];
    expect(pickBaseline(history, CURRENT, RECENT_DAYS)?.date).toBe('2026-06-01');
  });

  it('指定日数より前の記録が無ければ null（短い期間の伸びを 90 日分として見せない）', () => {
    expect(pickBaseline([at('2026-10-01', 700)], CURRENT, RECENT_DAYS)).toBeNull();
  });

  it('履歴が空なら null', () => {
    expect(pickBaseline([], CURRENT, RECENT_DAYS)).toBeNull();
  });
});

describe('upsertSnapshot', () => {
  it('同じ日付の記録を置き換えて件数を増やさない', () => {
    const history = [at('2026-09-20', 400), at('2026-10-11', 980)];
    const next = upsertSnapshot(history, CURRENT);
    expect(next).toHaveLength(2);
    expect(next.at(-1)?.xp.total).toBe(1000);
  });

  it('新しい日付は末尾に足し、常に昇順に並べる', () => {
    const next = upsertSnapshot([at('2026-10-11', 980), at('2026-09-20', 400)], at('2026-10-20', 1100));
    expect(next.map((item) => item.date)).toEqual(['2026-09-20', '2026-10-11', '2026-10-20']);
  });
});

describe('formatHistoryYaml', () => {
  it('注意書きを毎回付け直し、スキーマを通る YAML を書き出す', () => {
    const yaml = formatHistoryYaml([CURRENT]);
    expect(yaml.startsWith(HISTORY_HEADER)).toBe(true);
    expect(yaml).toContain('手で書き足さない');
    expect(historyFileSchema.safeParse(parseYaml(yaml)).success).toBe(true);
  });
});

describe('historyFileSchema', () => {
  /** safeParse の失敗メッセージを 1 本にまとめる（どの検証が働いたかを見る）。 */
  function messages(value: unknown): string {
    const result = historyFileSchema.safeParse(value);
    return result.success ? '' : result.error.issues.map((issue) => issue.message).join(' | ');
  }

  it('空の履歴は正常（まだ 1 件も記録していないのは初期状態）', () => {
    expect(historyFileSchema.safeParse({ snapshots: [] }).success).toBe(true);
  });

  it('xp.total が内訳の合計と合わないスナップショットを弾く', () => {
    const broken = {
      ...CURRENT,
      xp: { skills: 100, goals: 10, roadmap: 0, blog: 0, achievements: 0, total: 999 },
    };
    expect(messages({ snapshots: [broken] })).toContain('内訳の合計');
  });

  it('日付が降順の履歴を弾く', () => {
    expect(messages({ snapshots: [at('2026-10-11', 1000), at('2026-09-20', 400)] })).toContain(
      '昇順',
    );
  });

  it('同じ日付のスナップショットの重複を弾く', () => {
    expect(messages({ snapshots: [at('2026-10-11', 400), at('2026-10-11', 1000)] })).toContain(
      '重複',
    );
  });

  it('未知のキーを弾く（タイポした項目が黙って無視されるのを防ぐ）', () => {
    expect(messages({ snapshots: [{ ...CURRENT, skilAverage: 2.9 }] })).not.toBe('');
  });

  it('存在しない日付・範囲外のレベル平均を弾く', () => {
    expect(messages({ snapshots: [{ ...CURRENT, date: '2026-02-30' }] })).toContain('存在しない日付');
    expect(messages({ snapshots: [{ ...CURRENT, skillAverage: 5.5 }] })).not.toBe('');
  });

  it('XP に小数を許さない（領域ごとに丸める規則が崩れたことを検出する）', () => {
    const result = snapshotSchema.safeParse({
      ...CURRENT,
      xp: { skills: 10.5, goals: 0, roadmap: 0, blog: 0, achievements: 0, total: 10.5 },
    });
    expect(result.success).toBe(false);
  });
});
