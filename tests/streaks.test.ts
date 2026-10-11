import { describe, expect, it } from 'vitest';
import {
  blogMonthStreak,
  blogWeekStreak,
  computeStreaks,
  inventoryQuarterStreak,
  mondayOf,
  monthEnd,
  sundayOf,
} from '../src/lib/streaks.ts';

/**
 * 基準日は水曜に固定する（2026-10-07）。
 * 週は月曜始まりなので、この週は 2026-10-05（月）〜 2026-10-11（日）になる。
 * 週末でも週初でもない日を選ぶことで、「今週が未達でも連続数を保つ」振る舞いと
 * 「残り日数」の計算を同時に検証できる。
 */
const TODAY = '2026-10-07';

describe('週の境界', () => {
  it('月曜始まりで週を丸める', () => {
    expect(mondayOf('2026-10-05')).toBe('2026-10-05');
    expect(mondayOf('2026-10-07')).toBe('2026-10-05');
    // 日曜は前の月曜に属する（日曜始まりだと 1 日ずれる境界）。
    expect(mondayOf('2026-10-11')).toBe('2026-10-05');
    expect(mondayOf('2026-10-12')).toBe('2026-10-12');
  });

  it('週の最終日は日曜', () => {
    expect(sundayOf('2026-10-05')).toBe('2026-10-11');
  });

  it('月末を正しく求める（閏年を含む）', () => {
    expect(monthEnd('2026-10')).toBe('2026-10-31');
    expect(monthEnd('2026-02')).toBe('2026-02-28');
    expect(monthEnd('2028-02')).toBe('2028-02-29');
  });
});

describe('blogWeekStreak', () => {
  it('今週に記事があれば今週を含めて数える', () => {
    const result = blogWeekStreak(['2026-10-06', '2026-09-30', '2026-09-22'], TODAY);
    expect(result).toEqual({ weeks: 3, currentWeekDone: true });
  });

  it('今週まだ書いていなくても前週までの連続数を保つ', () => {
    const result = blogWeekStreak(['2026-09-30', '2026-09-22'], TODAY);
    expect(result).toEqual({ weeks: 2, currentWeekDone: false });
  });

  it('1 週飛ぶと連続が切れる', () => {
    // 2026-09-28 週（9/28〜10/4）に記事が無いので、今週の 1 週だけになる。
    const result = blogWeekStreak(['2026-10-06', '2026-09-22'], TODAY);
    expect(result).toEqual({ weeks: 1, currentWeekDone: true });
  });

  it('同じ週に複数投稿しても二重に数えない', () => {
    const result = blogWeekStreak(['2026-10-05', '2026-10-06', '2026-10-07'], TODAY);
    expect(result).toEqual({ weeks: 1, currentWeekDone: true });
  });

  it('基準日より後の日付は数えない（日付を先に入れた記事で今週を埋められない）', () => {
    expect(blogWeekStreak(['2026-10-12'], TODAY)).toEqual({ weeks: 0, currentWeekDone: false });
  });

  it('記事が 1 本も無ければ 0 週', () => {
    expect(blogWeekStreak([], TODAY)).toEqual({ weeks: 0, currentWeekDone: false });
  });
});

describe('blogMonthStreak', () => {
  it('今月に記事があれば今月を含めて数える', () => {
    expect(blogMonthStreak(['2026-10-01', '2026-09-15', '2026-08-02'], TODAY)).toBe(3);
  });

  it('今月まだ書いていなくても前月までの連続数を保つ', () => {
    expect(blogMonthStreak(['2026-09-15', '2026-08-02'], TODAY)).toBe(2);
  });

  it('1 ヶ月飛ぶと連続が切れる', () => {
    expect(blogMonthStreak(['2026-10-01', '2026-08-02'], TODAY)).toBe(1);
  });

  it('年をまたいでも連続が続く', () => {
    expect(blogMonthStreak(['2026-01-05', '2025-12-20'], '2026-01-10')).toBe(2);
  });
});

describe('inventoryQuarterStreak', () => {
  it('四半期ごとに 1 件以上の記録がある連続数を数える', () => {
    expect(inventoryQuarterStreak(['2026-04-10', '2026-07-15', '2026-10-01'], TODAY)).toBe(3);
  });

  it('今四半期の記録がまだ無くても前四半期までの連続数を保つ', () => {
    expect(inventoryQuarterStreak(['2026-04-10', '2026-07-15'], TODAY)).toBe(2);
  });

  it('四半期を飛ばすと連続が切れる', () => {
    expect(inventoryQuarterStreak(['2026-10-01', '2026-04-10'], TODAY)).toBe(1);
  });

  it('年をまたいでも連続が続く', () => {
    expect(inventoryQuarterStreak(['2026-01-05', '2025-10-20'], '2026-01-10')).toBe(2);
  });

  it('記録が無ければ 0 四半期', () => {
    expect(inventoryQuarterStreak([], TODAY)).toBe(0);
  });
});

describe('computeStreaks', () => {
  it('全ての期間が達成済みなら警告は出さない', () => {
    const streaks = computeStreaks({
      postDates: ['2026-10-06', '2026-09-30', '2026-09-22'],
      snapshotDates: ['2026-10-01', '2026-07-15'],
      today: TODAY,
    });
    expect(streaks.blogWeeks).toBe(3);
    expect(streaks.blogMonths).toBe(2);
    expect(streaks.inventoryQuarters).toBe(2);
    expect(streaks.atRisk).toEqual([]);
  });

  it('今週が未達なら連続数を保ったまま、期限と残り日数を添えて atRisk に入れる', () => {
    // 10/01 の記事で「今月は書いた」状態にし、週の警告だけが出ることを確かめる。
    const streaks = computeStreaks({
      postDates: ['2026-10-01', '2026-09-30', '2026-09-22'],
      snapshotDates: ['2026-10-01'],
      today: TODAY,
    });
    expect(streaks.blogWeeks).toBe(2);
    expect(streaks.atRisk).toHaveLength(1);
    const message = streaks.atRisk[0] ?? '';
    expect(message).toContain('連続投稿 2 週');
    // 日曜までに書けば途切れないことが分かる形になっている。
    expect(message).toContain('2026-10-11');
    expect(message).toContain('あと 4 日');
  });

  it('今月・今四半期が未達ならそれぞれ理由を入れる', () => {
    const streaks = computeStreaks({
      postDates: ['2026-09-30'],
      snapshotDates: ['2026-07-15'],
      today: TODAY,
    });
    expect(streaks.atRisk).toHaveLength(3);
    expect(streaks.atRisk.join('\n')).toContain('2026-10-31');
    expect(streaks.atRisk.join('\n')).toContain('2026-12-31');
  });

  it('守る連続が無いときは急かさない（ノイズで他の警告を埋めない）', () => {
    const streaks = computeStreaks({ postDates: [], snapshotDates: [], today: TODAY });
    expect(streaks).toEqual({ blogWeeks: 0, blogMonths: 0, inventoryQuarters: 0, atRisk: [] });
  });
});
