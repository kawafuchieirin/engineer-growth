/**
 * 成長の記録（data/history.yaml）の読み込みと差分の計算。
 *
 * この仕組みの中核は「伸びた」を数字で見せることにある。だからこそ
 * **嘘の 0 を見せない**のが最優先の要件になっている（docs/GAME_DESIGN.md「成長の差分」）。
 * 履歴が足りないときに `+0` と表示すると「やったのに増えていない」と読めてしまい、
 * 実際には比較する相手がいないだけなのに、続ける理由を削ってしまう。
 * 比較元が無い差分は配列に入れず、「記録を積むと差分が見られる」ことは表示側が伝える。
 */

import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import type { BlogModel } from './blog.ts';
import { daysBetween } from './date.ts';
import { GrowthError } from './errors.ts';
import type { GrowthDelta, Snapshot } from './game-types.ts';
import type { GoalsModel } from './goals.ts';
import { readYaml, writeOut } from './io.ts';
import { paths } from './paths.ts';
import type { RoadmapModel } from './roadmap.ts';
import type { SkillsModel } from './skills.ts';
import { computeXp, levelForXp } from './xp.ts';
import { historyFileSchema } from '../schema/history.ts';

/**
 * 履歴ファイルの位置。
 * paths.ts は変更前に相談が必要な共有基盤なので、data ディレクトリから組み立てる。
 */
export const historyPath = resolve(paths.data, 'history.yaml');

/** 「直近 N 日」の差分に使う期間。四半期の棚卸しサイクルに合わせて 90 日。 */
export const RECENT_DAYS = 90;

const LABEL_PREVIOUS = '前回の記録から';
const LABEL_RECENT = `直近 ${RECENT_DAYS} 日`;
const LABEL_FIRST = '始めてから';

/** 平均レベルの差は小数第 2 位まで。0.30000000000000004 のような表示を履歴にも差分にも出さない。 */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * data/history.yaml を読んで日付昇順のスナップショットを返す。ファイルが無ければ空配列。
 *
 * 「まだ 1 件も記録していない」は異常ではなく初期状態なので、エラーにしない。
 * 一方でファイルが存在するのに壊れている場合は readYaml が理由付きで落とす
 * （黙って空配列にすると、履歴を失ったまま新しい記録を積んでしまう）。
 */
export async function loadHistory(): Promise<readonly Snapshot[]> {
  const exists = await access(historyPath).then(
    () => true,
    () => false,
  );
  if (!exists) return [];

  const file = await readYaml(historyPath, historyFileSchema);
  // 昇順はスキーマが保証している（並び替えで黙って直すと、崩れた原因に気付けない）。
  return file.snapshots;
}

/**
 * 4 領域のモデルから基準日時点のスナップショットを組み立てる。
 *
 * `achievementXp` と `achievements` を引数で受けるのは、実績の判定
 * （src/lib/achievements.ts）にここから依存しないため。実績が未配線の状態でも
 * 履歴は積めるべきで、既定値は「実績なし」とする。
 */
export function buildSnapshot(input: {
  date: string;
  skills: SkillsModel;
  goals: GoalsModel;
  roadmap: RoadmapModel;
  blog: BlogModel;
  achievementXp?: number;
  achievements?: ReadonlyArray<string>;
}): Snapshot {
  const xp = computeXp({
    skills: input.skills,
    goals: input.goals,
    roadmap: input.roadmap,
    blog: input.blog,
    achievementXp: input.achievementXp ?? 0,
  });

  return {
    date: input.date,
    xp,
    level: levelForXp(xp.total),
    skillAverage: round2(input.skills.stats.averageLevel),
    skillCount: input.skills.stats.skillCount,
    posts: input.blog.posts.length,
    milestonesDone: input.roadmap.stats.done,
    goalsDone: input.goals.stats.all.done,
    achievements: [...(input.achievements ?? [])],
  };
}

/** 2 つのスナップショットの差。期間中に解放された実績も「増えたもの」として拾う。 */
function diff(label: string, from: Snapshot, current: Snapshot): GrowthDelta {
  const earned = new Set(from.achievements);
  return {
    label,
    fromDate: from.date,
    days: daysBetween(from.date, current.date),
    xp: current.xp.total - from.xp.total,
    level: current.level - from.level,
    skillAverage: round2(current.skillAverage - from.skillAverage),
    posts: current.posts - from.posts,
    milestonesDone: current.milestonesDone - from.milestonesDone,
    goalsDone: current.goalsDone - from.goalsDone,
    newAchievements: current.achievements.filter((id) => !earned.has(id)),
  };
}

/**
 * 現在値より前の記録だけを比較対象にする。
 *
 * 同じ日に snapshot を実行し直したとき、履歴には当日の記録が既に入っている。
 * それを比較元にすると「自分自身との差＝常に 0」になり、何もしていないように見える。
 * 当日の記録は現在値に置き換えられるものなので、比較元の候補から外す。
 */
function pastOf(history: readonly Snapshot[], current: Snapshot): readonly Snapshot[] {
  return history.filter((snapshot) => snapshot.date < current.date);
}

/**
 * `days` 日前以前で最も新しいスナップショット。見つからなければ null。
 *
 * 「90 日前に最も近いもの」を両側から探すのではなく、90 日以上前のものに限る。
 * 10 日前の記録を「直近 90 日」の比較元にすると、期間の表示と中身が食い違い、
 * 実際より短い期間の伸びを 90 日分の成果として見せてしまう。
 */
export function pickBaseline(
  history: readonly Snapshot[],
  current: Snapshot,
  days: number,
): Snapshot | null {
  const candidates = pastOf(history, current).filter(
    (snapshot) => daysBetween(snapshot.date, current.date) >= days,
  );
  return candidates.at(-1) ?? null;
}

/**
 * 「前回の記録から」「直近 90 日」「始めてから」の差分を、出せるものだけ返す（最大 3 件）。
 *
 * 比較元が同じ差分は 1 件にまとめる。履歴が 1 件しかなければ「前回の記録から」と
 * 「始めてから」は同じ比較になるので、先に来る「前回の記録から」だけを残す。
 * 同じ数字が 2 行並ぶと、どちらかが間違っているように見えて表示全体の信用を落とす。
 */
export function computeDeltas(history: readonly Snapshot[], current: Snapshot): GrowthDelta[] {
  const past = pastOf(history, current);
  if (past.length === 0) return [];

  const candidates: Array<{ label: string; from: Snapshot | null }> = [
    { label: LABEL_PREVIOUS, from: past.at(-1) ?? null },
    { label: LABEL_RECENT, from: pickBaseline(past, current, RECENT_DAYS) },
    { label: LABEL_FIRST, from: past[0] ?? null },
  ];

  const used = new Set<string>();
  const deltas: GrowthDelta[] = [];
  for (const candidate of candidates) {
    if (!candidate.from || used.has(candidate.from.date)) continue;
    used.add(candidate.from.date);
    deltas.push(diff(candidate.label, candidate.from, current));
  }
  return deltas;
}

/**
 * 書き出すときに毎回付け直すファイル先頭の注意書き。
 *
 * YAML を stringify で生成するとコメントは保持されないため、ここが唯一の情報源になる。
 * 「手で書き足さない」を書いておくのは、履歴を手で足せると分かった時点で
 * この仕組み全体が「自分に都合のいい過去を作る道具」に変わってしまうため。
 */
export const HISTORY_HEADER = [
  '# 成長の記録。pnpm growth snapshot で追記する（append-only）。',
  '# このファイルは手で書き足さない。過去を書き換えると「伸びた」が嘘になる。',
].join('\n');

/**
 * 同じ日付の記録を現在値で置き換えて昇順に並べる。
 *
 * 1 日に何度実行しても履歴が膨らまないようにするための上書き。
 * append-only の精神は「過去の日付を書き換えない」ことにあり、
 * その日の最新の値で当日の記録を更新するのはこれに反しない。
 */
export function upsertSnapshot(
  history: readonly Snapshot[],
  current: Snapshot,
): Snapshot[] {
  return [...history.filter((snapshot) => snapshot.date !== current.date), current].sort((a, b) =>
    a.date.localeCompare(b.date),
  );
}

/** 注意書き付きの YAML 文字列にする。文字列結合ではなく yaml パッケージに任せる。 */
export function formatHistoryYaml(snapshots: readonly Snapshot[]): string {
  // lineWidth: 0 で自動折り返しを止める。折り返されると 1 件が複数行に割れて差分が読みづらい。
  const body = stringifyYaml({ snapshots }, { lineWidth: 0 });
  return `${HISTORY_HEADER}\n${body}`;
}

/**
 * 履歴を書き出す。書く前に自分でスキーマ検証を通す。
 *
 * 「読むときに検証する」だけでは、壊れた記録がファイルに残ってから気付くことになり、
 * そのとき失われているのは今日の記録ではなく過去の記録との比較可能性である。
 */
export async function saveHistory(snapshots: readonly Snapshot[]): Promise<void> {
  const result = historyFileSchema.safeParse({ snapshots });
  if (!result.success) {
    throw new GrowthError('書き出そうとした履歴がスキーマに適合しません', [
      ...result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
    ]);
  }
  await writeOut(historyPath, formatHistoryYaml(snapshots));
}
