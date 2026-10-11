import { levelsFile, type LevelDefinition } from '../schema/common.ts';
import { toJstDate } from './date.ts';
import {
  skillsFile,
  type Skill,
  type SkillCategoryDefinition,
  type SkillsFile,
  type SkillsOwner,
} from '../schema/skills.ts';
import { readYaml } from './io.ts';
import { paths } from './paths.ts';

/** level 4 以上を「強み」とみなす。levels.yaml の 4 = 牽引 / 5 = 第一人者 に対応。 */
export const STRENGTH_LEVEL = 4;
/** level 3 以上（自走）は、根拠なしに自己申告しないという規律のしきい値。 */
export const EVIDENCE_REQUIRED_LEVEL = 3;
/** 最終利用から何ヶ月で「鈍っている可能性」として警告するか。 */
export const STALE_MONTHS = 12;
/**
 * 棚卸し日（owner.updated）が何ヶ月古くなったら警告するか。
 * 四半期棚卸しを 2 回飛ばした状態。棚卸し日は last_used の古さ判定の基準なので、
 * ここが古いままだと「鈍った技術」の検出そのものが効かなくなる。
 */
export const STALE_INVENTORY_MONTHS = 6;

export interface CategoryAggregate extends SkillCategoryDefinition {
  skills: Skill[];
  /** このカテゴリの現在レベル平均。スキルが無い場合は 0。 */
  averageLevel: number;
  /**
   * このカテゴリの目標レベル平均。
   * target 未設定は level を目標とみなし、level を下回る target は level に丸める（targetOf 参照）。
   * そのため必ず averageLevel 以上になる。
   */
  targetAverageLevel: number;
}

export interface SkillGap {
  skill: Skill;
  /** target - level（正の値のみ）。 */
  gap: number;
}

export interface SkillsStats {
  skillCount: number;
  averageLevel: number;
  weightedAverageLevel: number;
  strengthCount: number;
}

export interface SkillsModel {
  owner: SkillsOwner;
  /** 定義順のカテゴリ（レーダーチャートの軸順を決める）。 */
  categories: CategoryAggregate[];
  skills: Skill[];
  /** 全スキル ID。build/validate が参照整合性検証に使う（契約）。 */
  ids: string[];
  stats: SkillsStats;
  gaps: SkillGap[];
  strengths: Skill[];
  /** データ品質の注意。ビルドは止めないが、棚卸しの宿題として提示する。 */
  warnings: string[];
  /** レベル定義（data/levels.yaml）。レンダラは I/O しないのでモデルが運ぶ。 */
  levels: LevelDefinition[];
}

/**
 * weight の表示整形。YAML の `1.0` は数値 1 になり "1" と表示されて
 * 他の "1.2" と揃わないため、整数のときだけ小数第 1 位まで見せる
 * （値を丸めないので 1.25 は 1.25 のまま）。
 */
export function formatWeight(weight: number): string {
  return Number.isInteger(weight) ? weight.toFixed(1) : String(weight);
}

/** 小数の桁を揃える。平均値の表示・比較を安定させるため集計の出口で丸める。 */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * 集計で使う目標レベル。target 未設定は「現状維持」= level を目標とみなす。
 *
 * level を下回る target（過去に下げた目標）は level に丸める。
 * computeGaps が `target <= level` を「伸ばす余地なし」として除外しているため、
 * 生の target をそのまま平均すると定義が食い違い、「目標平均 < 平均」という
 * 不整合な表示（レーダーチャートの目標ポリゴンが現在ポリゴンの内側に入る）になる。
 * スキーマで `target >= level` を強制すると、既に超過したスキルの target を
 * 手で書き換える手間を強いる（実態をそのまま記録できなくなる）ので、
 * 「目標は現在を下回らない」という解釈を集計側に一本化する。
 */
function targetOf(entry: Skill): number {
  return Math.max(entry.level, entry.target ?? entry.level);
}

export function computeAverageLevel(skills: ReadonlyArray<Skill>): number {
  if (skills.length === 0) return 0;
  const total = skills.reduce((sum, entry) => sum + entry.level, 0);
  return round2(total / skills.length);
}

/**
 * カテゴリ weight による重み付き平均。
 * 各スキルに所属カテゴリの weight を掛けて平均するため、
 * 全カテゴリの weight が等しいときは averageLevel と一致する（検算しやすい）。
 * 未定義カテゴリ参照はスキーマで弾かれているが、防御的に weight 1 とする。
 */
export function computeWeightedAverageLevel(
  categories: ReadonlyArray<SkillCategoryDefinition>,
  skills: ReadonlyArray<Skill>,
): number {
  const weights = new Map(categories.map((category) => [category.id, category.weight]));
  let weighted = 0;
  let totalWeight = 0;
  for (const entry of skills) {
    const weight = weights.get(entry.category) ?? 1;
    weighted += entry.level * weight;
    totalWeight += weight;
  }
  if (totalWeight === 0) return 0;
  return round2(weighted / totalWeight);
}

/** カテゴリ定義順に、所属スキルと平均レベルをまとめる。 */
export function computeCategoryAggregates(
  categories: ReadonlyArray<SkillCategoryDefinition>,
  skills: ReadonlyArray<Skill>,
): CategoryAggregate[] {
  return categories.map((category) => {
    const owned = skills.filter((entry) => entry.category === category.id);
    const targetTotal = owned.reduce((sum, entry) => sum + targetOf(entry), 0);
    return {
      ...category,
      skills: owned,
      averageLevel: computeAverageLevel(owned),
      targetAverageLevel: owned.length === 0 ? 0 : round2(targetTotal / owned.length),
    };
  });
}

/**
 * 目標に届いていないスキルを gap 降順で返す。「次に何を伸ばすか」の順序になる。
 * target 未設定・target <= level は伸ばす余地がないので含めない。
 * 同 gap のときは現在レベルが低い順（着手の費用対効果が高い順）、
 * 最後に id 順で並べ、出力を決定的にする。
 */
export function computeGaps(skills: ReadonlyArray<Skill>): SkillGap[] {
  return skills
    .filter((entry) => entry.target !== undefined && entry.target > entry.level)
    .map((entry) => ({ skill: entry, gap: targetOf(entry) - entry.level }))
    .sort(
      (a, b) =>
        b.gap - a.gap || a.skill.level - b.skill.level || a.skill.id.localeCompare(b.skill.id),
    );
}

/** 強み（level 4 以上）をレベル降順で返す。 */
export function computeStrengths(skills: ReadonlyArray<Skill>): Skill[] {
  return skills
    .filter((entry) => entry.level >= STRENGTH_LEVEL)
    .sort((a, b) => b.level - a.level || a.id.localeCompare(b.id));
}

/**
 * YYYY-MM 同士の月数差（to - from）。
 * date.ts の daysBetween は日数なので「12 ヶ月」のしきい値がうるう年でぶれる。
 * 月単位の判定はここで閉じる。
 */
export function monthsBetween(fromYearMonth: string, toYearMonth: string): number {
  const [fromYear = 0, fromMonth = 0] = fromYearMonth.split('-').map(Number);
  const [toYear = 0, toMonth = 0] = toYearMonth.split('-').map(Number);
  return (toYear - fromYear) * 12 + (toMonth - fromMonth);
}

/**
 * データ品質の注意を集める。棚卸しの精度を保つための自己点検。
 * エラーにしないのは、記入途中でもサイトを生成できるようにするため。
 *
 * last_used の古さの基準日は `owner.updated`（棚卸し日）であって `now` ではない。
 * ビルド日を基準にすると、データを 1 文字も変えていないのに生成物の警告が
 * 増減して出力が非決定的になるため。`now` は「棚卸し日自体が古い」ことを
 * 知らせるためだけに使う（基準日が腐れば上の判定も腐るので、そこは見逃せない）。
 */
export function collectWarnings(file: SkillsFile, now: Date): string[] {
  const warnings: string[] = [];
  const currentYearMonth = file.owner.updated.slice(0, 7);

  const inventoryAge = monthsBetween(currentYearMonth, toJstDate(now).slice(0, 7));
  if (inventoryAge >= STALE_INVENTORY_MONTHS) {
    warnings.push(
      `棚卸し日 owner.updated が ${file.owner.updated}（約 ${inventoryAge} ヶ月前）です。棚卸しを実施して日付を更新してください（last_used の古さ判定はこの日付が基準です）。`,
    );
  }

  for (const entry of file.skills) {
    const label = `${entry.name} (${entry.id})`;

    if (entry.level >= EVIDENCE_REQUIRED_LEVEL && (entry.evidence?.length ?? 0) === 0) {
      warnings.push(
        `${label}: レベル ${entry.level} を主張していますが evidence が未記入です。根拠を 1 件以上書いてください。`,
      );
    }

    if (entry.last_used) {
      const months = monthsBetween(entry.last_used, currentYearMonth);
      if (months >= STALE_MONTHS) {
        warnings.push(
          `${label}: 最終利用が ${entry.last_used}（約 ${months} ヶ月前）です。レベルが実態と合っているか見直してください。`,
        );
      }
    }
  }

  for (const category of file.categories) {
    if (!file.skills.some((entry) => entry.category === category.id)) {
      warnings.push(
        `カテゴリ ${category.name} (${category.id}) に属するスキルがありません。削除するかスキルを追加してください。`,
      );
    }
  }

  return warnings;
}

/**
 * 検証済みデータから集計済みモデルを組み立てる（I/O を含まないので直接テストできる）。
 * now は警告判定の基準日。純粋関数に保つため呼び出し側から必ず渡す。
 */
export function buildSkillsModel(
  file: SkillsFile,
  levels: LevelDefinition[],
  now: Date,
): SkillsModel {
  const skills = file.skills;
  return {
    owner: file.owner,
    categories: computeCategoryAggregates(file.categories, skills),
    skills,
    ids: skills.map((entry) => entry.id),
    stats: {
      skillCount: skills.length,
      averageLevel: computeAverageLevel(skills),
      weightedAverageLevel: computeWeightedAverageLevel(file.categories, skills),
      strengthCount: skills.filter((entry) => entry.level >= STRENGTH_LEVEL).length,
    },
    gaps: computeGaps(skills),
    strengths: computeStrengths(skills),
    warnings: collectWarnings(file, now),
    levels,
  };
}

/**
 * data/skills.yaml と data/levels.yaml を読み、検証済みモデルを返す。
 * now を引数にしているのは、警告の基準日をテスト・CI から固定して
 * 出力を決定的にするため（他領域の loadBlogModel と同じ形に揃えている）。
 * デフォルト引数は now を持たない呼び出し元（CLI など）のために残す。
 */
export async function loadSkillsModel(now: Date = new Date()): Promise<SkillsModel> {
  const [file, levels] = await Promise.all([
    readYaml(paths.skills, skillsFile),
    readYaml(paths.levels, levelsFile),
  ]);
  return buildSkillsModel(file, levels.levels, now);
}
