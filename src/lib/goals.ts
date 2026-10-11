import { goalsFileSchema } from '../schema/goals.ts';
import type { Goal, GoalStatus, GoalsFile, Horizon, KeyResult } from '../schema/goals.ts';
import type { SkillReferencing } from './consistency.ts';
import { daysBetween, toJstDate } from './date.ts';
import { GrowthError } from './errors.ts';
import { readYaml } from './io.ts';
import { paths } from './paths.ts';

/**
 * at-risk 判定のしきい値。
 * 「期末が近い」のに「進捗が低い」目標だけを拾いたいので、2 つの定数で挟む。
 * 定数にしてあるのは、感覚で判定基準を動かさないため（動かすならここを 1 箇所変える）。
 */
/** 期末までの残日数がこれ以下なら、リスク判定の対象期間に入ったとみなす（約 1 ヶ月）。 */
export const AT_RISK_WITHIN_DAYS = 30;
/** 対象期間で進捗がこれ未満なら at-risk。0.5 = 残り 1 ヶ月で半分も終わっていない。 */
export const AT_RISK_PROGRESS_BELOW = 0.5;

/** 達成率の集計から外す状態。dropped は「やらないと決めた」ので失点にしない。 */
const EXCLUDED_FROM_PROGRESS: ReadonlyArray<GoalStatus> = ['dropped'];
/** 進捗が止まっていてもリスクではない状態（完了済み・取りやめ）。 */
const SETTLED_STATUSES: ReadonlyArray<GoalStatus> = ['done', 'dropped'];

/**
 * 進捗計算に必要な最小形。
 * 生の Goal でも集計済みの GoalView でも同じ関数に渡せるよう、構造で受ける
 * （GoalView は key_results が readonly なので Goal としては渡せない）。
 */
export interface ProgressInput {
  readonly status: GoalStatus;
  readonly key_results: ReadonlyArray<KeyResult>;
}

/** 四半期単位の集計に必要な最小形。 */
export interface QuarterlyProgressInput extends ProgressInput {
  readonly quarter: string;
}

export interface KeyResultView extends KeyResult {
  /** 0-1。current / target を 1 で打ち切った値。 */
  readonly progress: number;
}

export interface GoalView extends Omit<Goal, 'key_results'> {
  readonly key_results: ReadonlyArray<KeyResultView>;
  /** 0-1。status が done なら 1、それ以外は Key Result 進捗の単純平均。 */
  readonly progress: number;
  /** 期末までの残日数（負なら期末を過ぎている）。 */
  readonly daysToQuarterEnd: number;
  /** 期末が近いのに進捗が足りていない（= 今まだ手当てできる）。 */
  readonly atRisk: boolean;
  /** 期末を過ぎたまま決着していない（= もう手当てできない。棚卸し対象）。 */
  readonly stale: boolean;
}

export interface QuarterGroup {
  readonly quarter: string;
  readonly goals: ReadonlyArray<GoalView>;
  /** その四半期の達成率（dropped を除く平均）。 */
  readonly progress: number;
}

/** focusQuarter だけを対象にした集計。dropped は分母から外す。 */
export interface GoalsFocusStats {
  /** 集計対象の四半期（= GoalsModel.focusQuarter）。 */
  readonly quarter: string;
  /** progress の分母。この四半期の dropped 以外の件数。 */
  readonly total: number;
  /** この四半期の done の件数。 */
  readonly done: number;
  /** この四半期の at-risk の件数。 */
  readonly atRisk: number;
  /** 0-1。この四半期の達成率（done は 1 として数える）。 */
  readonly progress: number;
}

/** 全四半期・全 status を対象にした件数。達成率の分母とは別物。 */
export interface GoalsAllStats {
  /** 全四半期・全 status の総件数。 */
  readonly total: number;
  readonly done: number;
  readonly inProgress: number;
  readonly notStarted: number;
  readonly dropped: number;
  /** at-risk の件数（過去四半期のものは stale に入るので含まれない）。 */
  readonly atRisk: number;
  /** 期末を過ぎたまま決着していない件数。 */
  readonly stale: number;
}

/**
 * 集計スコープごとに数字を分けて持つ。
 * 「達成率 66%（目標 5 件）」のように分母の違う数字を並べると
 * 読み手が「5 件中の 66%」と誤読するため、型で混ぜられないようにしている。
 */
export interface GoalsStats {
  /**
   * 0-1。focusQuarter の達成率（= focus.progress と同じ値）。
   *
   * 分母は focusQuarter のうち dropped 以外。all.total とは分母が違う。
   * src/commands/validate.ts が参照しているため後方互換で残している。
   */
  readonly overallProgress: number;
  readonly focus: GoalsFocusStats;
  readonly all: GoalsAllStats;
}

export interface GoalsModel extends SkillReferencing {
  readonly horizon: Horizon;
  readonly goals: ReadonlyArray<GoalView>;
  /** 全目標 ID。build/validate が参照整合性検証に使う（契約。SkillsModel.ids と対称）。 */
  readonly ids: ReadonlyArray<string>;
  readonly quarters: ReadonlyArray<QuarterGroup>;
  /** 期末が近いのに進捗が足りていない目標。 */
  readonly atRisk: ReadonlyArray<GoalView>;
  /** 期末を過ぎたまま決着していない目標。at-risk とは手の打ち方が違うので分ける。 */
  readonly stale: ReadonlyArray<GoalView>;
  /** 集計の基準日（JST の YYYY-MM-DD）。 */
  readonly today: string;
  /** stats.focus / stats.overallProgress の対象四半期。 */
  readonly focusQuarter: string;
  readonly stats: GoalsStats;
}

/** YYYY-MM-DD が属する四半期（YYYY-Qn）。 */
export function quarterOf(date: string): string {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(date);
  if (!match?.[1] || !match[2]) {
    throw new GrowthError(`日付として解釈できません: ${date}`, ['YYYY-MM-DD 形式で渡してください']);
  }
  return `${match[1]}-Q${Math.floor((Number(match[2]) - 1) / 3) + 1}`;
}

/** 四半期の初日・最終日（YYYY-MM-DD）。暦の四半期（1-3 月 = Q1）で扱う。 */
export function quarterRange(quarter: string): { start: string; end: string } {
  const match = /^(\d{4})-Q([1-4])$/.exec(quarter);
  if (!match?.[1] || !match[2]) {
    throw new GrowthError(`四半期として解釈できません: ${quarter}`, ['YYYY-Qn 形式で渡してください']);
  }
  const year = match[1];
  const index = Number(match[2]);
  const startMonth = index * 3 - 2;
  const endMonth = index * 3;
  // 翌月 0 日 = 当月末日。月末が 28/30/31 のどれかを自前で判定しないで済む。
  const endDay = new Date(Date.UTC(Number(year), endMonth, 0)).getUTCDate();
  return {
    start: `${year}-${String(startMonth).padStart(2, '0')}-01`,
    end: `${year}-${String(endMonth).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`,
  };
}

/** Key Result の進捗。超過達成を 1 で打ち切るのは、1 つの KR で全体を水増しさせないため。 */
export function keyResultProgress(keyResult: KeyResult): number {
  return Math.min(keyResult.current / keyResult.target, 1);
}

/**
 * 目標の進捗。
 * status が done なら 1 として扱う（KR の数字が追いついていなくても
 * 「達成した」という判断を正とする。done は人間の宣言であり、数字より強い）。
 */
export function goalProgress(goal: ProgressInput): number {
  if (goal.status === 'done') return 1;
  // key_results は 1 件以上をスキーマで保証しているが、ProgressInput は型で空配列を
  // 禁止できない（export された関数なのでスキーマを通らない値も届く）。NaN を返すと
  // 達成率やバー幅まで NaN が伝播し、原因から遠い場所で壊れるため明示的に 0 にする。
  if (goal.key_results.length === 0) return 0;
  const total = goal.key_results.reduce((sum, keyResult) => sum + keyResultProgress(keyResult), 0);
  return total / goal.key_results.length;
}

/**
 * at-risk 判定 = 「今まだ間に合わせられるのに遅れている」目標。
 * 「まだ決着していない」かつ「期末が残っている」かつ「期末が近い」かつ「進捗が低い」。
 *
 * 期末を過ぎたものを含めないのは、at-risk の目的が「やり切る / 目標値を下げる /
 * 取りやめる」の判断を促すことにあるため。終わった四半期にその選択肢はもう無く、
 * 並べておくと毎回同じ項目が残り続けて一覧そのものが読まれなくなる。
 * 期末を過ぎた未完了は isStale が拾う（手当てではなく棚卸しの対象）。
 */
export function isAtRisk(goal: QuarterlyProgressInput, today: string): boolean {
  if (SETTLED_STATUSES.includes(goal.status)) return false;
  const daysLeft = daysBetween(today, quarterRange(goal.quarter).end);
  // 期末当日（daysLeft === 0）はまだ期中なので対象に含める。
  if (daysLeft < 0 || daysLeft > AT_RISK_WITHIN_DAYS) return false;
  return goalProgress(goal) < AT_RISK_PROGRESS_BELOW;
}

/**
 * stale 判定 = 「期末を過ぎたのに done / dropped に確定していない」目標。
 * 進捗の高さは見ない。未確定であること自体が振り返りの未了を意味するため。
 */
export function isStale(goal: Pick<QuarterlyProgressInput, 'status' | 'quarter'>, today: string): boolean {
  if (SETTLED_STATUSES.includes(goal.status)) return false;
  return daysBetween(today, quarterRange(goal.quarter).end) < 0;
}

/**
 * 達成率。
 * 分母は「対象四半期のうち dropped でない目標」。
 * - dropped を外すのは、やらないと決めた結果を未達として数えないため。
 * - done は分母に残して進捗 1 として数える。外すと「全部終わった四半期」が
 *   対象 0 件になり達成率が計算できず、実態と逆の表示になる。
 */
export function overallProgress(
  goals: ReadonlyArray<QuarterlyProgressInput>,
  focusQuarter: string,
): number {
  const targets = goals.filter(
    (goal) => goal.quarter === focusQuarter && !EXCLUDED_FROM_PROGRESS.includes(goal.status),
  );
  if (targets.length === 0) return 0;
  return targets.reduce((sum, goal) => sum + goalProgress(goal), 0) / targets.length;
}

/**
 * 達成率を出す対象四半期を決める。
 * 基準日の四半期に目標があればそれを使う。なければ「基準日以前で最も新しい四半期」、
 * それも無ければ最古の四半期。基準日が目標の無い四半期に入った途端に
 * 達成率 0% と表示されるのを避けるため（データが古いだけで未達ではない）。
 */
export function pickFocusQuarter(goals: ReadonlyArray<{ quarter: string }>, today: string): string {
  const current = quarterOf(today);
  // YYYY-Qn は辞書順と時系列順が一致する。
  const quarters = [...new Set(goals.map((goal) => goal.quarter))].sort();
  if (quarters.length === 0) return current;
  if (quarters.includes(current)) return current;
  const past = quarters.filter((candidate) => candidate < current);
  return past.at(-1) ?? quarters[0] ?? current;
}

/** 四半期ごとにまとめる。新しい四半期が先頭（直近の計画を上に出す）。 */
export function groupByQuarter(goals: ReadonlyArray<GoalView>): QuarterGroup[] {
  const quarters = [...new Set(goals.map((goal) => goal.quarter))].sort().reverse();
  return quarters.map((quarter) => {
    const inQuarter = goals.filter((goal) => goal.quarter === quarter);
    return { quarter, goals: inQuarter, progress: overallProgress(inQuarter, quarter) };
  });
}

/** 目標が参照しているスキル ID と、その出所。data/skills.yaml との整合性検証に使う。 */
export function referencedSkillIds(goals: ReadonlyArray<Goal>): Array<{ id: string; source: string }> {
  return goals.flatMap((goal) =>
    goal.skills.map((id) => ({ id, source: `goals.yaml の ${goal.id}` })),
  );
}

/** 検証済みファイル内容と基準日からモデルを組み立てる純粋関数。テストはここを叩く。 */
export function buildGoalsModel(file: GoalsFile, today: string): GoalsModel {
  const goals: GoalView[] = file.goals.map((goal) => ({
    ...goal,
    key_results: goal.key_results.map((keyResult) => ({
      ...keyResult,
      progress: keyResultProgress(keyResult),
    })),
    progress: goalProgress(goal),
    daysToQuarterEnd: daysBetween(today, quarterRange(goal.quarter).end),
    atRisk: isAtRisk(goal, today),
    stale: isStale(goal, today),
  }));

  const atRisk = goals.filter((goal) => goal.atRisk);
  const stale = goals.filter((goal) => goal.stale);
  const focusQuarter = pickFocusQuarter(file.goals, today);
  const countOf = (status: GoalStatus): number => goals.filter((goal) => goal.status === status).length;

  const inFocus = goals.filter((goal) => goal.quarter === focusQuarter);
  // 達成率の分母と同じ集合。件数と率の分母をずらさないため同じ述語から作る。
  const focusCounted = inFocus.filter((goal) => !EXCLUDED_FROM_PROGRESS.includes(goal.status));
  const focusProgress = overallProgress(file.goals, focusQuarter);

  return {
    horizon: file.horizon,
    goals,
    ids: file.goals.map((goal) => goal.id),
    quarters: groupByQuarter(goals),
    atRisk,
    stale,
    today,
    focusQuarter,
    referencedSkillIds: referencedSkillIds(file.goals),
    stats: {
      overallProgress: focusProgress,
      focus: {
        quarter: focusQuarter,
        total: focusCounted.length,
        done: focusCounted.filter((goal) => goal.status === 'done').length,
        atRisk: inFocus.filter((goal) => goal.atRisk).length,
        progress: focusProgress,
      },
      all: {
        total: goals.length,
        done: countOf('done'),
        inProgress: countOf('in_progress'),
        notStarted: countOf('not_started'),
        dropped: countOf('dropped'),
        atRisk: atRisk.length,
        stale: stale.length,
      },
    },
  };
}

/**
 * data/goals.yaml を読み込んで検証し、集計済みモデルを返す。
 * 「今日」を引数で受けるのは、同じ実行内の全モデルが同一の基準日を使うようにするため
 * （呼び出しごとに new Date() を引くと日付の境界で生成物が食い違う）。
 */
export async function loadGoalsModel(now: Date = new Date()): Promise<GoalsModel> {
  const file = await readYaml(paths.goals, goalsFileSchema);
  return buildGoalsModel(file, toJstDate(now));
}
