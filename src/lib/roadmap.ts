import { roadmapFileSchema } from '../schema/roadmap.ts';
import type { Milestone, MilestoneStatus, RoadmapFile, Track } from '../schema/roadmap.ts';
import type { SkillReferencing } from './consistency.ts';
import { toJstDate } from './date.ts';
import { GrowthError } from './errors.ts';
import { readYaml } from './io.ts';
import { paths } from './paths.ts';

export interface MilestoneView extends Milestone {
  /** track の表示名。描画のたびに tracks を引き直さないよう解決済みで持つ。 */
  readonly trackName: string;
  readonly stepsDone: number;
  readonly stepsTotal: number;
  /** 0-1。steps の完了率。status に関係なく steps だけを見た素の値。 */
  readonly stepProgress: number;
  /** 0-1。status が done なら 1（done は outcome 達成の宣言で、チェック漏れより強い）。 */
  readonly progress: number;
  /** due を過ぎているのに完了していない。 */
  readonly overdue: boolean;
  /** depends_on のうち、まだ完了していないマイルストーン id。自分が done なら常に空。 */
  readonly blockers: ReadonlyArray<string>;
}

export interface TrackView extends Track {
  /** そのトラックのマイルストーン（start 昇順）。 */
  readonly milestones: ReadonlyArray<MilestoneView>;
}

export interface RoadmapStats {
  readonly total: number;
  readonly done: number;
  readonly inProgress: number;
  readonly planned: number;
  readonly blocked: number;
  readonly overdue: number;
  /** 0-1。done / total。カードの「完了 N/M」と分母が一致する完了率。 */
  readonly completion: number;
  /** 0-1。全マイルストーンの進捗（done は 1、他は steps 完了率）の平均。 */
  readonly progress: number;
}

/** 目標 ID を参照する側のモデルが満たすべき最小形（consistency.ts の SkillReferencing と同形）。 */
export interface GoalReferencing {
  /** 参照している目標 ID（重複可）と、その出所の説明。 */
  readonly referencedGoalIds: ReadonlyArray<{ id: string; source: string }>;
}

export interface RoadmapModel extends SkillReferencing, GoalReferencing {
  readonly updated: string;
  /** start 昇順（同日なら id 昇順）。 */
  readonly milestones: ReadonlyArray<MilestoneView>;
  readonly tracks: ReadonlyArray<TrackView>;
  /** start 〜 due 全体を覆う月の並び（YYYY-MM）。ガントチャートの横軸。 */
  readonly months: ReadonlyArray<string>;
  /** 集計の基準日（JST の YYYY-MM-DD）。 */
  readonly today: string;
  readonly stats: RoadmapStats;
}

/** due を過ぎていて、かつ完了していないか。「今日」は必ず引数で受け取る（判定を決定的にするため）。 */
export function isOverdue(milestone: Milestone, today: string): boolean {
  // ISO 8601 の日付は辞書順＝時系列順。
  return milestone.due < today && milestone.status !== 'done';
}

/** steps の完了率（0-1）。 */
export function stepProgress(milestone: Milestone): number {
  const done = milestone.steps.filter((step) => step.done).length;
  // steps は 1 件以上をスキーマで保証しているが、0 除算は明示的に避ける。
  return milestone.steps.length === 0 ? 0 : done / milestone.steps.length;
}

/** マイルストーンの進捗。done は 1 として扱う（goals.ts の goalProgress と同じ方針）。 */
export function milestoneProgress(milestone: Milestone): number {
  return milestone.status === 'done' ? 1 : stepProgress(milestone);
}

/**
 * depends_on のうち未完了のもの = 着手してもブロックされる原因。
 *
 * 自分が done なら空を返す。すでに終わっているものに「待ち」は存在せず、
 * 残すと「手当てが必要なマイルストーン」に完了済みの項目が並んで一覧が信用できなくなる
 * （依存先の status を後から直し忘れただけ、というケースがほとんど）。
 */
export function blockersOf(
  milestone: Milestone,
  statusById: ReadonlyMap<string, MilestoneStatus>,
): string[] {
  if (milestone.status === 'done') return [];
  return (milestone.depends_on ?? []).filter((id) => statusById.get(id) !== 'done');
}

/** from〜to を覆う月（YYYY-MM）の並び。ガントチャートの横軸に使う。 */
export function enumerateMonths(from: string, to: string): string[] {
  const months: string[] = [];
  let [year, month] = [Number(from.slice(0, 4)), Number(from.slice(5, 7))];
  const last = to.slice(0, 7);
  for (let guard = 0; guard < 600; guard += 1) {
    const current = `${year}-${String(month).padStart(2, '0')}`;
    months.push(current);
    if (current >= last) return months;
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  throw new GrowthError('ロードマップの期間が長すぎます', [`${from} 〜 ${to}`]);
}

/** マイルストーンが参照しているスキル ID と、その出所。 */
export function referencedSkillIds(
  milestones: ReadonlyArray<Milestone>,
): Array<{ id: string; source: string }> {
  return milestones.flatMap((milestone) =>
    milestone.skills.map((id) => ({ id, source: `roadmap.yaml の ${milestone.id}` })),
  );
}

/** マイルストーンが参照している目標 ID と、その出所。data/goals.yaml との整合性検証に使う。 */
export function referencedGoalIds(
  milestones: ReadonlyArray<Milestone>,
): Array<{ id: string; source: string }> {
  return milestones.flatMap((milestone) =>
    (milestone.goals ?? []).map((id) => ({ id, source: `roadmap.yaml の ${milestone.id}` })),
  );
}

/**
 * 参照されている目標 ID が data/goals.yaml に存在するかを横断検証する。
 * ロードマップは目標の実行計画なので、存在しない目標への紐付けは計画の腐敗。
 *
 * assertSkillReferences と同じ形（既知 ID の一覧 + 参照元モデルの配列）にしてあるのは、
 * ファイルを跨ぐ検証を呼び出し側（commands/）の 1 箇所にまとめるため。
 * lib 側で goals.yaml を読み直すと同じファイルを 2 回パースすることになり、
 * goals.yaml が壊れているときに roadmap.yaml 側のエラーが見えなくなる。
 */
export function assertGoalReferences(
  knownGoalIds: ReadonlyArray<string>,
  referrers: ReadonlyArray<GoalReferencing>,
): void {
  const known = new Set(knownGoalIds);
  const problems: string[] = [];

  for (const referrer of referrers) {
    for (const ref of referrer.referencedGoalIds) {
      if (!known.has(ref.id)) {
        problems.push(`${ref.source} が未定義の目標 ID "${ref.id}" を参照しています`);
      }
    }
  }

  if (problems.length > 0) {
    throw new GrowthError('目標 ID の参照整合性エラー', problems);
  }
}

/** 検証済みファイル内容と基準日からモデルを組み立てる純粋関数。テストはここを叩く。 */
export function buildRoadmapModel(file: RoadmapFile, today: string): RoadmapModel {
  const trackNames = new Map(file.tracks.map((track) => [track.id, track.name] as const));
  const statusById = new Map(file.milestones.map((milestone) => [milestone.id, milestone.status] as const));

  const milestones: MilestoneView[] = [...file.milestones]
    .sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id))
    .map((milestone) => ({
      ...milestone,
      // track の存在はスキーマで保証済み。?? は型を絞るためのフォールバック。
      trackName: trackNames.get(milestone.track) ?? milestone.track,
      stepsDone: milestone.steps.filter((step) => step.done).length,
      stepsTotal: milestone.steps.length,
      stepProgress: stepProgress(milestone),
      progress: milestoneProgress(milestone),
      overdue: isOverdue(milestone, today),
      blockers: blockersOf(milestone, statusById),
    }));

  const countOf = (status: MilestoneStatus): number =>
    milestones.filter((milestone) => milestone.status === status).length;

  const starts = milestones.map((milestone) => milestone.start).sort();
  const dues = milestones.map((milestone) => milestone.due).sort();

  return {
    updated: file.updated,
    milestones,
    tracks: file.tracks.map((track) => ({
      ...track,
      milestones: milestones.filter((milestone) => milestone.track === track.id),
    })),
    months: enumerateMonths(starts[0] ?? today, dues.at(-1) ?? today),
    today,
    referencedSkillIds: referencedSkillIds(file.milestones),
    referencedGoalIds: referencedGoalIds(file.milestones),
    stats: {
      total: milestones.length,
      done: countOf('done'),
      inProgress: countOf('in_progress'),
      planned: countOf('planned'),
      blocked: countOf('blocked'),
      overdue: milestones.filter((milestone) => milestone.overdue).length,
      completion: milestones.length === 0 ? 0 : countOf('done') / milestones.length,
      progress:
        milestones.length === 0
          ? 0
          : milestones.reduce((sum, milestone) => sum + milestone.progress, 0) / milestones.length,
    },
  };
}

/**
 * data/roadmap.yaml を読み込んで検証し、集計済みモデルを返す。
 *
 * ファイルを跨ぐ参照（milestone.goals / skills）はここでは検証しない。
 * モデルは referencedGoalIds / referencedSkillIds として「誰が何を参照しているか」
 * だけを公開し、突き合わせは全ファイルを読み終えた呼び出し側（commands/）が行う。
 * こうしておくと 1 ファイルの破損が他ファイルのエラー表示を潰さない。
 *
 * 「今日」を引数で受けるのは、同じ実行内の全モデルが同一の基準日を使うようにするため。
 */
export async function loadRoadmapModel(now: Date = new Date()): Promise<RoadmapModel> {
  const file = await readYaml(paths.roadmap, roadmapFileSchema);
  return buildRoadmapModel(file, toJstDate(now));
}
