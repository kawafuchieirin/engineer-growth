import { GrowthError } from '../lib/errors.ts';
import { formatWeight, loadSkillsModel, type CategoryAggregate, type SkillsModel } from '../lib/skills.ts';
import type { Command } from './types.ts';

interface Options {
  category?: string;
  gapsOnly: boolean;
}

/** 引数解析。未知のオプションは黙って無視せず GrowthError で知らせる。 */
function parseOptions(args: ReadonlyArray<string>): Options {
  const options: Options = { gapsOnly: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--gaps') {
      options.gapsOnly = true;
    } else if (arg === '--category') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) {
        throw new GrowthError('--category にはカテゴリ id が必要です', [
          '例: pnpm growth skills-report --category infra',
        ]);
      }
      options.category = value;
      index += 1;
    } else if (arg?.startsWith('--category=')) {
      options.category = arg.slice('--category='.length);
    } else {
      throw new GrowthError(`未知のオプション: ${arg}`, ['使い方: pnpm growth skills-report --help']);
    }
  }
  if (options.category === '') {
    throw new GrowthError('--category にはカテゴリ id が必要です');
  }
  return options;
}

/** 棒グラフ風のレベル表示。ターミナルで一覧の高低を掴めるようにする。 */
function levelBar(level: number): string {
  return '█'.repeat(level) + '·'.repeat(5 - level);
}

function selectCategories(model: SkillsModel, categoryId: string | undefined): CategoryAggregate[] {
  if (!categoryId) return model.categories.filter((category) => category.skills.length > 0);
  const found = model.categories.find((category) => category.id === categoryId);
  if (!found) {
    throw new GrowthError(`未知のカテゴリ id: ${categoryId}`, [
      `利用可能: ${model.categories.map((category) => category.id).join(', ')}`,
    ]);
  }
  return [found];
}

export const skillsReportCommand: Command = {
  name: 'skills-report',
  summary: 'スキル棚卸しのサマリをターミナルに表示する',
  usage: `使い方: pnpm growth skills-report [options]

data/skills.yaml を検証して集計結果を表示します。

オプション:
  --category <id>   指定カテゴリのみ表示する（例: infra, backend, soft）
  --gaps            目標とのギャップがあるスキルだけを表示する
  -h, --help        このヘルプを表示する

例:
  pnpm growth skills-report
  pnpm growth skills-report --category infra
  pnpm growth skills-report --gaps`,
  async run({ args, log, now }) {
    const options = parseOptions(args);
    // now を渡して警告判定の基準日を明示する（実行時刻に暗黙依存させない）。
    const model = await loadSkillsModel(now);
    const categories = selectCategories(model, options.category);
    const inScope = new Set(categories.flatMap((category) => category.skills.map((skill) => skill.id)));
    const categoryNames = new Map(model.categories.map((category) => [category.id, category.name]));

    log(`スキル棚卸し: ${model.owner.name}（${model.owner.role}）/ 更新 ${model.owner.updated}`);
    log(
      `スキル ${model.stats.skillCount} 件 / 平均 ${model.stats.averageLevel.toFixed(2)} / 重み付き平均 ${model.stats.weightedAverageLevel.toFixed(
        2,
      )} / レベル4以上 ${model.stats.strengthCount} 件`,
    );

    const gaps = model.gaps.filter((gap) => inScope.has(gap.skill.id));

    if (!options.gapsOnly) {
      for (const category of categories) {
        log('');
        log(
          `[${category.id}] ${category.name}  weight ${formatWeight(category.weight)} / 平均 ${category.averageLevel.toFixed(
            2,
          )} → 目標 ${category.targetAverageLevel.toFixed(2)}`,
        );
        for (const skill of category.skills) {
          const target = skill.target === undefined ? '維持' : `目標 ${skill.target}`;
          log(`  ${levelBar(skill.level)} ${skill.level}  ${skill.name}  (${target})`);
        }
      }
    }

    log('');
    log('次に伸ばすスキル（ギャップ降順）:');
    if (gaps.length === 0) {
      log('  なし（対象スキルはすべて目標に達しています）');
    } else {
      for (const { skill, gap } of gaps) {
        log(
          `  +${gap}  ${skill.name}  ${skill.level} → ${skill.target ?? skill.level}  [${categoryNames.get(skill.category) ?? skill.category}]`,
        );
      }
    }

    // warning はデータ品質の宿題なので、絞り込み表示でも必ず最後に出す。
    if (model.warnings.length > 0) {
      log('');
      log(`データ品質の注意 (${model.warnings.length} 件):`);
      for (const warning of model.warnings) log(`  - ${warning}`);
    }
  },
};
