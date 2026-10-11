import { GrowthError } from './errors.ts';

/** スキル ID を参照する側のモデルが満たすべき最小形。 */
export interface SkillReferencing {
  /** 参照しているスキル ID（重複可）と、その出所の説明。 */
  referencedSkillIds: ReadonlyArray<{ id: string; source: string }>;
}

/**
 * 目標・ロードマップ・ブログが参照するスキル ID が data/skills.yaml に
 * 存在するかを横断検証する。存在しない参照はデータの腐敗なので失敗させる。
 */
export function assertSkillReferences(
  knownSkillIds: ReadonlyArray<string>,
  referrers: ReadonlyArray<SkillReferencing>,
): void {
  const known = new Set(knownSkillIds);
  const problems: string[] = [];

  for (const referrer of referrers) {
    for (const ref of referrer.referencedSkillIds) {
      if (!known.has(ref.id)) {
        problems.push(`${ref.source} が未定義のスキル ID "${ref.id}" を参照しています`);
      }
    }
  }

  if (problems.length > 0) {
    throw new GrowthError('スキル ID の参照整合性エラー', problems);
  }
}
