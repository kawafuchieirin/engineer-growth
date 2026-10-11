/**
 * ストリーク（継続の記録）の集計。規則の正は docs/GAME_DESIGN.md「ストリーク」。
 *
 * 入力は `YYYY-MM-DD` の文字列だけにしている。Date を受け取るとタイムゾーンの解釈が
 * 呼び出し側ごとに揺れ、「JST では今週なのに UTC では先週」という形で週の境界がずれる。
 * 日付の文字列は辞書順＝時系列順なので、週・月・四半期への丸めも文字列のまま完結する。
 *
 * 途切れ判定は「基準日の期間がまだ未達でも、前の期間までの連続数を保つ」方針を取る。
 * 今週書いていないだけで 0 になると、まだ間に合う状況で諦める理由を与えてしまう。
 */

import { daysBetween } from './date.ts';
import type { StreakInfo } from './game-types.ts';
import { quarterOf, quarterRange } from './goals.ts';

/** 1 日のミリ秒。日付文字列の加減算にだけ使う（時刻は常に UTC 00:00 固定）。 */
const DAY_MS = 86_400_000;

/** `YYYY-MM-DD` を指定日数ずらす。UTC 00:00 固定で計算するので夏時間の影響を受けない。 */
function shiftDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** その日が属する週（月曜始まり）の月曜日。週の識別子として使う。 */
export function mondayOf(date: string): string {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  // getUTCDay は日曜が 0。月曜を 0 にしたいので +6 して 7 で丸める。
  return shiftDays(date, -((weekday + 6) % 7));
}

/** 週（月曜日で表す）の最終日＝日曜日。「いつまでに書けば間に合うか」の提示に使う。 */
export function sundayOf(monday: string): string {
  return shiftDays(monday, 6);
}

/** その日が属する月（`YYYY-MM`）。 */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

/** 月（`YYYY-MM`）の最終日。 */
export function monthEnd(month: string): string {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7));
  // Date.UTC の day に 0 を渡すと前月の末日になる。
  return new Date(Date.UTC(year, index, 0)).toISOString().slice(0, 10);
}

/** 1 つ前の月（`YYYY-MM`）。 */
function previousMonth(month: string): string {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7));
  return index === 1
    ? `${year - 1}-12`
    : `${year}-${String(index - 1).padStart(2, '0')}`;
}

/** 1 つ前の四半期（`YYYY-Qn`）。 */
function previousQuarter(quarter: string): string {
  const year = Number(quarter.slice(0, 4));
  const index = Number(quarter.slice(6, 7));
  return index === 1 ? `${year - 1}-Q4` : `${year}-Q${index - 1}`;
}

/**
 * 連続数の共通ロジック。
 *
 * 基準期間が未達なら 1 つ前の期間から数え始める（連続数を保つ）。
 * 期間は Set で持つので、同じ週に 3 本書いても 1 週としか数えない。
 */
function consecutive(
  buckets: ReadonlySet<string>,
  current: string,
  previous: (bucket: string) => string,
): { count: number; currentDone: boolean } {
  const currentDone = buckets.has(current);
  let cursor = currentDone ? current : previous(current);
  let count = 0;
  // buckets は有限集合なので、連続が切れた時点で必ず止まる。
  while (buckets.has(cursor)) {
    count += 1;
    cursor = previous(cursor);
  }
  return { count, currentDone };
}

/**
 * 未来日を落とす。日付を先に入れた記事で「今週書いた」ことにならないようにする
 * （その記事はその週が来たときに数えられる）。
 */
function upTo(dates: ReadonlyArray<string>, today: string): string[] {
  return dates.filter((date) => date <= today);
}

/**
 * 連続投稿週数。基準日の週にまだ記事がなければ `currentWeekDone: false` を返し、
 * 連続数は前週までのものを保つ。
 */
export function blogWeekStreak(
  postDates: ReadonlyArray<string>,
  today: string,
): { weeks: number; currentWeekDone: boolean } {
  const weeks = new Set(upTo(postDates, today).map(mondayOf));
  const { count, currentDone } = consecutive(weeks, mondayOf(today), (week) => shiftDays(week, -7));
  return { weeks: count, currentWeekDone: currentDone };
}

/** 連続投稿月数。週と同じ考え方を月単位で行う。 */
export function blogMonthStreak(postDates: ReadonlyArray<string>, today: string): number {
  const months = new Set(upTo(postDates, today).map(monthOf));
  return consecutive(months, monthOf(today), previousMonth).count;
}

/**
 * 連続棚卸し四半期数。各四半期に 1 件以上スナップショットがある連続数。
 * 棚卸しの記録（data/history.yaml の date）が判定の根拠になる。
 */
export function inventoryQuarterStreak(
  snapshotDates: ReadonlyArray<string>,
  today: string,
): number {
  const quarters = new Set(upTo(snapshotDates, today).map(quarterOf));
  return consecutive(quarters, quarterOf(today), previousQuarter).count;
}

/**
 * ストリークをまとめ、途切れる手前のものを `atRisk` に理由付きで入れる。
 *
 * 警告は「連続数が 1 以上あって、基準期間がまだ未達」のときだけ出す。
 * 守るものが無い状態（連続 0）で急かすと、ただのノイズになって他の警告も読まれなくなる。
 * 文面には期限日と残り日数を入れる（何をすれば途切れないかを明示するため）。
 */
export function computeStreaks(input: {
  postDates: ReadonlyArray<string>;
  snapshotDates: ReadonlyArray<string>;
  today: string;
}): StreakInfo {
  const { postDates, snapshotDates, today } = input;
  const atRisk: string[] = [];

  const week = blogWeekStreak(postDates, today);
  const months = new Set(upTo(postDates, today).map(monthOf));
  const month = consecutive(months, monthOf(today), previousMonth);
  const quarters = new Set(upTo(snapshotDates, today).map(quarterOf));
  const quarter = consecutive(quarters, quarterOf(today), previousQuarter);

  if (week.weeks > 0 && !week.currentWeekDone) {
    const deadline = sundayOf(mondayOf(today));
    atRisk.push(
      `連続投稿 ${week.weeks} 週が途切れかけています。今週（${mondayOf(today)} 〜 ${deadline}）の記事を` +
        `${deadline} まで（あと ${daysBetween(today, deadline)} 日）に公開してください。`,
    );
  }

  if (month.count > 0 && !month.currentDone) {
    const deadline = monthEnd(monthOf(today));
    atRisk.push(
      `連続投稿 ${month.count} ヶ月が途切れかけています。今月（${monthOf(today)}）の記事を` +
        `${deadline} まで（あと ${daysBetween(today, deadline)} 日）に公開してください。`,
    );
  }

  if (quarter.count > 0 && !quarter.currentDone) {
    const deadline = quarterRange(quarterOf(today)).end;
    atRisk.push(
      `連続棚卸し ${quarter.count} 四半期が途切れかけています。${deadline} までに ` +
        `data/skills.yaml を棚卸しして pnpm growth snapshot を実行してください。`,
    );
  }

  return {
    blogWeeks: week.weeks,
    blogMonths: month.count,
    inventoryQuarters: quarter.count,
    atRisk,
  };
}
