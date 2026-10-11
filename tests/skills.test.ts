import { describe, expect, it } from 'vitest';
import {
  buildSkillsModel,
  collectWarnings,
  computeAverageLevel,
  computeCategoryAggregates,
  computeGaps,
  computeStrengths,
  computeWeightedAverageLevel,
  monthsBetween,
} from '../src/lib/skills.ts';
import { renderSkillsCard, renderSkillsMarkdown, renderSkillsPage } from '../src/render/skills.ts';
import { skillsFile, type Skill, type SkillsFile } from '../src/schema/skills.ts';
import type { LevelDefinition } from '../src/schema/common.ts';

/** テストは実データに依存させない。必要最小のインラインフィクスチャで振る舞いを固定する。 */
function skill(overrides: Partial<Skill> & Pick<Skill, 'id' | 'category' | 'level'>): Skill {
  return { name: overrides.id, ...overrides };
}

/**
 * 警告判定の基準日。owner.updated と同じ日にすることで
 * 「棚卸し日が古い」警告が混ざらないようにする（実行日に依存しない）。
 */
const NOW = new Date('2026-10-11T00:00:00Z');

const levels: LevelDefinition[] = Array.from({ length: 6 }, (_, level) => ({
  level,
  name: `レベル${level}`,
  description: `レベル${level}の定義`,
}));

function fixtureFile(overrides: Partial<SkillsFile> = {}): SkillsFile {
  return {
    owner: { name: 'テスト太郎', role: 'SRE', updated: '2026-10-11' },
    categories: [
      { id: 'infra', name: 'インフラ', weight: 2.0 },
      { id: 'soft', name: 'ソフト', weight: 0.5 },
    ],
    skills: [
      skill({ id: 'infra-a', category: 'infra', level: 4, target: 5, evidence: ['本番運用'] }),
      skill({ id: 'soft-a', category: 'soft', level: 0, target: 3 }),
    ],
    ...overrides,
  };
}

describe('computeWeightedAverageLevel', () => {
  it('重みの大きいカテゴリのレベルを強く反映する', () => {
    const file = fixtureFile();
    expect(computeAverageLevel(file.skills)).toBe(2); // (4 + 0) / 2
    // (4*2.0 + 0*0.5) / 2.5 = 3.2 → 単純平均より infra 側へ寄る
    expect(computeWeightedAverageLevel(file.categories, file.skills)).toBe(3.2);
  });

  it('重みが全て等しいときは単純平均と一致する', () => {
    const categories = [
      { id: 'infra', name: 'インフラ', weight: 1.0 },
      { id: 'soft', name: 'ソフト', weight: 1.0 },
    ];
    const skills = [
      skill({ id: 'infra-a', category: 'infra', level: 4 }),
      skill({ id: 'soft-a', category: 'soft', level: 1 }),
    ];
    expect(computeWeightedAverageLevel(categories, skills)).toBe(computeAverageLevel(skills));
  });

  it('スキルが無いときは 0 を返す（0 除算しない）', () => {
    expect(computeWeightedAverageLevel(fixtureFile().categories, [])).toBe(0);
    expect(computeAverageLevel([])).toBe(0);
  });
});

describe('computeGaps', () => {
  it('gap の降順に並ぶ', () => {
    const skills = [
      skill({ id: 'a', category: 'infra', level: 3, target: 4 }),
      skill({ id: 'b', category: 'infra', level: 1, target: 5 }),
      skill({ id: 'c', category: 'infra', level: 2, target: 4 }),
    ];
    expect(computeGaps(skills).map((gap) => [gap.skill.id, gap.gap])).toEqual([
      ['b', 4],
      ['c', 2],
      ['a', 1],
    ]);
  });

  it('target 未設定・target <= level は含めない', () => {
    const skills = [
      skill({ id: 'no-target', category: 'infra', level: 2 }),
      skill({ id: 'reached', category: 'infra', level: 4, target: 4 }),
      skill({ id: 'exceeded', category: 'infra', level: 5, target: 3 }),
      skill({ id: 'behind', category: 'infra', level: 1, target: 2 }),
    ];
    expect(computeGaps(skills).map((gap) => gap.skill.id)).toEqual(['behind']);
  });

  it('gap が同じときは現在レベルが低い順に並ぶ（着手しやすさの順）', () => {
    const skills = [
      skill({ id: 'high', category: 'infra', level: 3, target: 4 }),
      skill({ id: 'low', category: 'infra', level: 1, target: 2 }),
    ];
    expect(computeGaps(skills).map((gap) => gap.skill.id)).toEqual(['low', 'high']);
  });
});

describe('computeStrengths / computeCategoryAggregates', () => {
  it('レベル4以上のみをレベル降順で返す', () => {
    const skills = [
      skill({ id: 'a', category: 'infra', level: 4 }),
      skill({ id: 'b', category: 'infra', level: 3 }),
      skill({ id: 'c', category: 'infra', level: 5 }),
    ];
    expect(computeStrengths(skills).map((entry) => entry.id)).toEqual(['c', 'a']);
  });

  it('カテゴリ平均と目標平均を定義順で返し、target 未設定は level を目標とみなす', () => {
    const file = fixtureFile({
      skills: [
        skill({ id: 'infra-a', category: 'infra', level: 2, target: 4 }),
        skill({ id: 'infra-b', category: 'infra', level: 3 }),
        skill({ id: 'soft-a', category: 'soft', level: 1, target: 2 }),
      ],
    });
    const aggregates = computeCategoryAggregates(file.categories, file.skills);
    expect(aggregates.map((category) => category.id)).toEqual(['infra', 'soft']);
    expect(aggregates[0]!.averageLevel).toBe(2.5);
    expect(aggregates[0]!.targetAverageLevel).toBe(3.5); // (4 + 3) / 2
    expect(aggregates[1]!.skills).toHaveLength(1);
  });

  it('level > target でもカテゴリ目標平均が平均を下回らない', () => {
    // computeGaps は target <= level を「伸ばす余地なし」として除外するため、
    // 目標平均も同じ解釈（目標は現在を下回らない）で計算されないと表示が矛盾する。
    const categories = [{ id: 'infra', name: 'インフラ', weight: 1 }];
    const skills = [
      skill({ id: 'exceeded', category: 'infra', level: 5, target: 3 }),
      skill({ id: 'behind', category: 'infra', level: 1, target: 2 }),
    ];
    const aggregate = computeCategoryAggregates(categories, skills)[0]!;
    expect(aggregate.averageLevel).toBe(3); // (5 + 1) / 2
    expect(aggregate.targetAverageLevel).toBe(3.5); // (max(5, 3) + 2) / 2
    expect(aggregate.targetAverageLevel).toBeGreaterThanOrEqual(aggregate.averageLevel);
  });

  it('スキルが 0 件のカテゴリも平均 0 で残す', () => {
    const aggregates = computeCategoryAggregates(fixtureFile().categories, []);
    expect(aggregates).toHaveLength(2);
    expect(aggregates[0]!.averageLevel).toBe(0);
    expect(aggregates[0]!.targetAverageLevel).toBe(0);
  });
});

describe('collectWarnings', () => {
  it('レベル3以上で evidence が無いスキルを検出する', () => {
    const warnings = collectWarnings(
      fixtureFile({
        skills: [
          skill({ id: 'no-evidence', category: 'infra', level: 3 }),
          skill({ id: 'with-evidence', category: 'infra', level: 3, evidence: ['根拠'] }),
          skill({ id: 'low-level', category: 'soft', level: 2 }),
        ],
      }),
      NOW,
    );
    expect(warnings.filter((warning) => warning.includes('evidence'))).toHaveLength(1);
    expect(warnings.some((warning) => warning.includes('no-evidence'))).toBe(true);
  });

  it('evidence が空配列でも未記入として扱う', () => {
    const warnings = collectWarnings(
      fixtureFile({
        skills: [skill({ id: 'empty', category: 'infra', level: 4, evidence: [] })],
      }),
      NOW,
    );
    expect(warnings.some((warning) => warning.includes('evidence'))).toBe(true);
  });

  it('last_used が owner.updated から 12 ヶ月以上前なら検出する', () => {
    const warnings = collectWarnings(
      fixtureFile({
        skills: [
          skill({ id: 'stale', category: 'infra', level: 1, last_used: '2025-10' }),
          skill({ id: 'fresh', category: 'soft', level: 1, last_used: '2026-05' }),
        ],
      }),
      NOW,
    );
    const stale = warnings.filter((warning) => warning.includes('最終利用'));
    expect(stale).toHaveLength(1);
    expect(stale[0]).toContain('stale');
  });

  it('スキルが属していないカテゴリを検出する', () => {
    const warnings = collectWarnings(
      fixtureFile({
        skills: [skill({ id: 'infra-a', category: 'infra', level: 1 })],
      }),
      NOW,
    );
    expect(warnings.some((warning) => warning.includes('soft'))).toBe(true);
  });

  it('棚卸し日 (owner.updated) 自体が古ければ now 基準で警告する', () => {
    const warnings = collectWarnings(
      fixtureFile({ owner: { name: 'テスト太郎', role: 'SRE', updated: '2026-01-11' } }),
      NOW,
    );
    expect(warnings.some((warning) => warning.includes('owner.updated'))).toBe(true);
  });

  it('適切に記入されたデータでは警告を出さない', () => {
    expect(
      collectWarnings(
        fixtureFile({
          skills: [
            skill({ id: 'infra-a', category: 'infra', level: 3, evidence: ['根拠'], last_used: '2026-10' }),
            skill({ id: 'soft-a', category: 'soft', level: 2, last_used: '2026-09' }),
          ],
        }),
        NOW,
      ),
    ).toEqual([]);
  });
});

describe('monthsBetween', () => {
  it('年をまたいだ月数差を返す', () => {
    expect(monthsBetween('2025-10', '2026-10')).toBe(12);
    expect(monthsBetween('2026-09', '2026-10')).toBe(1);
    expect(monthsBetween('2024-01', '2026-10')).toBe(33);
  });
});

describe('skillsFile スキーマ', () => {
  function errorsOf(input: unknown): string[] {
    const result = skillsFile.safeParse(input);
    expect(result.success).toBe(false);
    if (result.success) return [];
    return result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
  }

  it('未知のカテゴリ参照をエラーにする', () => {
    const errors = errorsOf(
      fixtureFile({ skills: [skill({ id: 'x', category: 'unknown', level: 1 })] }),
    );
    expect(errors.some((error) => error.includes('skills.0.category') && error.includes('unknown'))).toBe(
      true,
    );
  });

  it('スキル ID の重複をエラーにする', () => {
    const errors = errorsOf(
      fixtureFile({
        skills: [
          skill({ id: 'dup', category: 'infra', level: 1 }),
          skill({ id: 'dup', category: 'infra', level: 2 }),
        ],
      }),
    );
    expect(errors.some((error) => error.includes('skills.1.id') && error.includes('dup'))).toBe(true);
  });

  it('カテゴリ ID の重複をエラーにする', () => {
    const errors = errorsOf(
      fixtureFile({
        categories: [
          { id: 'infra', name: 'A', weight: 1 },
          { id: 'infra', name: 'B', weight: 1 },
        ],
      }),
    );
    expect(errors.some((error) => error.includes('categories.1.id'))).toBe(true);
  });

  it('レベル範囲外をエラーにする', () => {
    const errors = errorsOf(
      fixtureFile({ skills: [skill({ id: 'x', category: 'infra', level: 6 })] }),
    );
    expect(errors.some((error) => error.startsWith('skills.0.level'))).toBe(true);
  });

  it('目標レベル範囲外をエラーにする', () => {
    const errors = errorsOf(
      fixtureFile({ skills: [skill({ id: 'x', category: 'infra', level: 1, target: -1 })] }),
    );
    expect(errors.some((error) => error.startsWith('skills.0.target'))).toBe(true);
  });

  it('kebab-case でない ID をエラーにする', () => {
    const errors = errorsOf(
      fixtureFile({ skills: [skill({ id: 'Infra_A', category: 'infra', level: 1 })] }),
    );
    expect(errors.some((error) => error.startsWith('skills.0.id'))).toBe(true);
  });

  it('last_used が YYYY-MM 形式でなければエラーにする', () => {
    const errors = errorsOf(
      fixtureFile({
        skills: [skill({ id: 'x', category: 'infra', level: 1, last_used: '2026-09-01' })],
      }),
    );
    expect(errors.some((error) => error.startsWith('skills.0.last_used'))).toBe(true);
    expect(errors.some((error) => error.includes('YYYY-MM'))).toBe(true);
  });

  it('weight の範囲外をエラーにする', () => {
    const errors = errorsOf(
      fixtureFile({ categories: [{ id: 'infra', name: 'インフラ', weight: 3 }] }),
    );
    expect(errors.some((error) => error.startsWith('categories.0.weight'))).toBe(true);
  });

  it('未知のキーを拒否し、エラーメッセージにキー名を含める', () => {
    // `taget: 5`（target のタイポ）が黙って捨てられると、
    // 「目標未設定＝現状維持」と誤って集計されてしまう。
    const base = fixtureFile();
    const skillErrors = errorsOf({
      ...base,
      skills: [{ id: 'typo', name: 'タイポ', category: 'infra', level: 1, taget: 5 }],
    });
    expect(skillErrors.some((error) => error.includes('taget'))).toBe(true);
    expect(skillErrors.some((error) => error.startsWith('skills.0'))).toBe(true);

    expect(
      errorsOf({ ...base, owner: { ...base.owner, rol: 'SRE' } }).some((error) =>
        error.includes('rol'),
      ),
    ).toBe(true);
    expect(
      errorsOf({ ...base, categories: [{ ...base.categories[0]!, weigth: 1 }] }).some((error) =>
        error.includes('weigth'),
      ),
    ).toBe(true);
    expect(errorsOf({ ...base, skils: [] }).some((error) => error.includes('skils'))).toBe(true);
  });

  it('正しいデータは通る', () => {
    expect(skillsFile.safeParse(fixtureFile()).success).toBe(true);
  });
});

describe('レンダラ', () => {
  const model = buildSkillsModel(fixtureFile(), levels, NOW);
  /** レーダーチャートは軸 3 本以上で成立するため、チャート検証用は 3 カテゴリにする。 */
  const chartModel = buildSkillsModel(
    fixtureFile({
      categories: [
        { id: 'infra', name: 'インフラ', weight: 2.0 },
        { id: 'soft', name: 'ソフト', weight: 0.5 },
        { id: 'data', name: 'データ', weight: 1.0 },
      ],
      skills: [
        skill({ id: 'infra-a', category: 'infra', level: 4, target: 5, evidence: ['本番運用'] }),
        skill({ id: 'soft-a', category: 'soft', level: 0, target: 3 }),
        skill({ id: 'data-a', category: 'data', level: 2, target: 4 }),
      ],
    }),
    levels,
    NOW,
  );

  it('スキルページにメトリクス・レーダーチャート・レベル定義が含まれる', () => {
    const html = renderSkillsPage(chartModel, '2026-10-11 09:00 (JST)');
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('class="chart"');
    expect(html).toContain('<polygon');
    expect(html).toContain('現在レベル');
    expect(html).toContain('目標レベル');
    expect(html).toContain('重み付き平均');
    expect(html).toContain('レベル定義');
    expect(html).toContain('level-chip');
    expect(html).toContain('bar-fill');
  });

  it('データ品質の警告を .badge--warn で提示する', () => {
    const withWarnings = buildSkillsModel(
      fixtureFile({
        skills: [skill({ id: 'infra-a', category: 'infra', level: 4 })],
      }),
      levels,
      NOW,
    );
    expect(withWarnings.warnings.length).toBeGreaterThan(0);
    expect(renderSkillsPage(withWarnings, 'now')).toContain('badge--warn');
  });

  it('スキル名・notes・リンクをエスケープする', () => {
    const dangerous = buildSkillsModel(
      fixtureFile({
        skills: [
          skill({
            id: 'xss',
            name: '<script>alert("x")</script>',
            category: 'infra',
            level: 4,
            target: 5,
            evidence: ['<img src=x onerror=alert(1)>'],
            notes: "a'b&c",
            links: [{ label: '<b>link</b>', url: 'https://example.com/?a=1&b=2' }],
          }),
        ],
      }),
      levels,
      NOW,
    );
    const html = renderSkillsPage(dangerous, 'now');
    expect(html).not.toContain('<script>alert');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp;b=2');
    expect(html).toContain('&#39;');
    // カード・SVG の軸ラベルも同じ経路でエスケープされること
    expect(renderSkillsCard(dangerous)).not.toContain('<script>alert');
  });

  it('カテゴリ名が SVG のテキストでエスケープされる', () => {
    const dangerous = buildSkillsModel(
      fixtureFile({
        categories: [
          { id: 'a', name: '<svg onload="x">', weight: 1 },
          { id: 'b', name: 'B', weight: 1 },
          { id: 'c', name: 'C', weight: 1 },
        ],
        skills: [
          skill({ id: 'a-1', category: 'a', level: 1 }),
          skill({ id: 'b-1', category: 'b', level: 2 }),
          skill({ id: 'c-1', category: 'c', level: 3, evidence: ['根拠'] }),
        ],
      }),
      levels,
      NOW,
    );
    const html = renderSkillsPage(dangerous, 'now');
    expect(html).toContain('&lt;svg onload=&quot;x&quot;&gt;');
    expect(html).not.toContain('<svg onload=');
  });

  it('軸が 3 本未満ならレーダーチャートの代わりに .empty を出す', () => {
    const html = renderSkillsPage(model, 'now');
    expect(html).toContain('class="empty"');
    expect(html).not.toContain('class="chart"');
  });

  it('Markdown 節が ## スキル から始まり、テーブルを含む', () => {
    const markdown = renderSkillsMarkdown(model);
    expect(markdown.startsWith('## スキル')).toBe(true);
    expect(markdown).toContain('| カテゴリ | 重み | スキル数 | 平均 | 目標平均 |');
    expect(markdown).toContain('### 次に伸ばすスキル');
    expect(markdown).toContain('| インフラ | 2.0 | 1 |'); // weight 2.0 が "2" に潰れない
  });

  it('Markdown のセル内の | をエスケープしてテーブルを壊さない', () => {
    const piped = buildSkillsModel(
      fixtureFile({ categories: [{ id: 'infra', name: 'A|B', weight: 1 }] }),
      levels,
      NOW,
    );
    expect(renderSkillsMarkdown(piped)).toContain('| A\\|B |');
  });

  it('外部リンクに rel="noreferrer noopener" を付ける', () => {
    const linked = buildSkillsModel(
      fixtureFile({
        skills: [
          skill({
            id: 'infra-a',
            category: 'infra',
            level: 2,
            links: [{ label: '資料', url: 'https://example.com/' }],
          }),
        ],
      }),
      levels,
      NOW,
    );
    expect(renderSkillsPage(linked, 'now')).toContain('rel="noreferrer noopener"');
  });

  it('カードが section.card 断片を返す', () => {
    const card = renderSkillsCard(model);
    expect(card.trim().startsWith('<section class="card">')).toBe(true);
    expect(card.trim().endsWith('</section>')).toBe(true);
    expect(card).toContain('skills.html');
  });
});
