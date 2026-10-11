import { describe, expect, it } from 'vitest';
import {
  AT_RISK_PROGRESS_BELOW,
  AT_RISK_WITHIN_DAYS,
  buildGoalsModel,
  goalProgress,
  groupByQuarter,
  isAtRisk,
  isStale,
  keyResultProgress,
  overallProgress,
  pickFocusQuarter,
  quarterOf,
  quarterRange,
} from '../src/lib/goals.ts';
import { goalsFileSchema } from '../src/schema/goals.ts';

/** safeParse の失敗メッセージを 1 本の文字列にまとめる（どのメッセージが出たかを検証する）。 */
function issueMessages(result: { success: boolean; error?: { issues: Array<{ message: string }> } }): string {
  return (result.error?.issues ?? []).map((issue) => issue.message).join(' | ');
}
import { oneLine, renderGoalsCard, renderGoalsMarkdown, renderGoalsPage } from '../src/render/goals.ts';

/** 最小限の Key Result。進捗だけを見るテスト用。 */
function keyResult(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'kr-1',
    description: '何かを 3 件やる',
    metric: '完了件数',
    target: 3,
    current: 0,
    ...overrides,
  };
}

function goal(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'g-sample',
    objective: 'サンプルの目標',
    quarter: '2026-Q4',
    status: 'in_progress',
    why: 'テストのため',
    skills: ['infra-terraform'],
    key_results: [keyResult()],
    ...overrides,
  };
}

function goalsFile(goals: Array<Record<string, unknown>>): Record<string, unknown> {
  return {
    horizon: { vision: 'ありたい姿', updated: '2026-10-11' },
    goals,
  };
}

/** フィクスチャもスキーマを通す。実データと同じ経路を通ることを保証するため。 */
function parse(file: Record<string, unknown>) {
  return goalsFileSchema.parse(file);
}

describe('スキーマ検証', () => {
  it('id が kebab-case でなければエラーになる', () => {
    const result = goalsFileSchema.safeParse(goalsFile([goal({ id: 'Goal_1' })]));
    expect(result.success).toBe(false);
    expect(issueMessages(result)).toContain('kebab-case');
  });

  it('目標 id の重複を検出する', () => {
    const result = goalsFileSchema.safeParse(goalsFile([goal({ id: 'g-a' }), goal({ id: 'g-a' })]));
    expect(result.success).toBe(false);
    expect(issueMessages(result)).toContain('"g-a" が重複');
  });

  it('Key Result id の目標内重複を検出する', () => {
    const result = goalsFileSchema.safeParse(
      goalsFile([goal({ key_results: [keyResult({ id: 'kr-x' }), keyResult({ id: 'kr-x' })] })]),
    );
    expect(result.success).toBe(false);
    expect(issueMessages(result)).toContain('kr-x');
  });

  it('target が 0 以下、current が負数ならエラーになる', () => {
    expect(goalsFileSchema.safeParse(goalsFile([goal({ key_results: [keyResult({ target: 0 })] })])).success).toBe(false);
    expect(goalsFileSchema.safeParse(goalsFile([goal({ key_results: [keyResult({ current: -1 })] })])).success).toBe(false);
  });

  it('status は列挙値以外を受け付けない', () => {
    expect(goalsFileSchema.safeParse(goalsFile([goal({ status: 'paused' })])).success).toBe(false);
  });

  it('why を省略できない', () => {
    const invalid = goal();
    delete invalid.why;
    expect(goalsFileSchema.safeParse(goalsFile([invalid])).success).toBe(false);
  });

  it('未知のキーを許さない（タイポを見逃さない）', () => {
    expect(goalsFileSchema.safeParse(goalsFile([goal({ quater: '2026-Q4' })])).success).toBe(false);
  });
});

describe('四半期の計算', () => {
  it('日付から四半期を求める', () => {
    expect(quarterOf('2026-01-01')).toBe('2026-Q1');
    expect(quarterOf('2026-03-31')).toBe('2026-Q1');
    expect(quarterOf('2026-10-11')).toBe('2026-Q4');
  });

  it('四半期の初日と最終日を求める', () => {
    expect(quarterRange('2026-Q1')).toEqual({ start: '2026-01-01', end: '2026-03-31' });
    expect(quarterRange('2026-Q2')).toEqual({ start: '2026-04-01', end: '2026-06-30' });
    expect(quarterRange('2026-Q4')).toEqual({ start: '2026-10-01', end: '2026-12-31' });
  });
});

describe('進捗計算', () => {
  it('current が target を超えても 1 を超えない', () => {
    expect(keyResultProgress({ id: 'kr-1', description: 'd', metric: 'm', target: 3, current: 9 })).toBe(1);
  });

  it('目標の進捗は Key Result の平均', () => {
    const parsed = parse(
      goalsFile([
        goal({
          key_results: [
            keyResult({ id: 'kr-1', target: 10, current: 10 }),
            keyResult({ id: 'kr-2', target: 10, current: 0 }),
          ],
        }),
      ]),
    );
    expect(goalProgress(parsed.goals[0]!)).toBe(0.5);
  });

  it('key_results が空なら NaN ではなく 0 を返す', () => {
    // スキーマは min(1) で弾くが、goalProgress は export されており
    // ProgressInput は型で空配列を禁止できないため、関数側で防ぐ。
    expect(goalProgress({ status: 'in_progress', key_results: [] })).toBe(0);
  });

  it('status が done の目標は数値に関係なく進捗 1', () => {
    const parsed = parse(goalsFile([goal({ status: 'done', key_results: [keyResult({ current: 0 })] })]));
    expect(goalProgress(parsed.goals[0]!)).toBe(1);
  });

  it('dropped は達成率の分母から除外される', () => {
    const parsed = parse(
      goalsFile([
        goal({ id: 'g-live', key_results: [keyResult({ target: 10, current: 5 })] }),
        goal({ id: 'g-dead', status: 'dropped', key_results: [keyResult({ target: 10, current: 0 })] }),
      ]),
    );
    // dropped を含めると 0.25 になる。除外されていれば 0.5。
    expect(overallProgress(parsed.goals, '2026-Q4')).toBe(0.5);
  });

  it('done は分母に残り、進捗 1 として数えられる', () => {
    const parsed = parse(
      goalsFile([
        goal({ id: 'g-done', status: 'done', key_results: [keyResult({ current: 0 })] }),
        goal({ id: 'g-zero', key_results: [keyResult({ current: 0 })] }),
      ]),
    );
    expect(overallProgress(parsed.goals, '2026-Q4')).toBe(0.5);
  });

  it('対象四半期に目標がなければ 0', () => {
    const parsed = parse(goalsFile([goal()]));
    expect(overallProgress(parsed.goals, '2027-Q2')).toBe(0);
  });
});

describe('at-risk 判定の境界', () => {
  const atRiskGoal = parse(goalsFile([goal({ key_results: [keyResult({ target: 10, current: 4 })] })])).goals[0]!;
  const halfDoneGoal = parse(goalsFile([goal({ key_results: [keyResult({ target: 10, current: 5 })] })])).goals[0]!;

  it(`期末まで ${AT_RISK_WITHIN_DAYS} 日ちょうどは対象期間に入る`, () => {
    // 2026-Q4 の期末は 2026-12-31。その 30 日前が 2026-12-01。
    expect(isAtRisk(atRiskGoal, '2026-12-01')).toBe(true);
  });

  it(`期末まで ${AT_RISK_WITHIN_DAYS + 1} 日なら対象期間に入らない`, () => {
    expect(isAtRisk(atRiskGoal, '2026-11-30')).toBe(false);
  });

  it(`進捗が ${AT_RISK_PROGRESS_BELOW} ちょうどなら at-risk ではない`, () => {
    expect(isAtRisk(halfDoneGoal, '2026-12-01')).toBe(false);
  });

  it('期末当日はまだ対象期間に入る', () => {
    expect(isAtRisk(atRiskGoal, '2026-12-31')).toBe(true);
  });

  it('期末の翌日からは at-risk ではなく stale になる', () => {
    // 終わった四半期に「やり切る / 落とす」の選択肢は無いので、手当てを促さない。
    expect(isAtRisk(atRiskGoal, '2027-01-01')).toBe(false);
    expect(isStale(atRiskGoal, '2027-01-01')).toBe(true);
  });

  it('期末を過ぎても進捗が高ければ stale（進捗の高さは見ない）', () => {
    expect(isStale(halfDoneGoal, '2027-01-15')).toBe(true);
  });

  it('期中は stale ではない', () => {
    expect(isStale(atRiskGoal, '2026-12-31')).toBe(false);
  });

  it('done と dropped は期末を過ぎても stale にならない', () => {
    const settled = parse(
      goalsFile([
        goal({ id: 'g-done', status: 'done', key_results: [keyResult({ current: 0 })] }),
        goal({ id: 'g-dropped', status: 'dropped', key_results: [keyResult({ current: 0 })] }),
      ]),
    ).goals;
    expect(settled.map((item) => isStale(item, '2027-01-15'))).toEqual([false, false]);
  });

  it('done と dropped は at-risk にならない', () => {
    const settled = parse(
      goalsFile([
        goal({ id: 'g-done', status: 'done', key_results: [keyResult({ current: 0 })] }),
        goal({ id: 'g-dropped', status: 'dropped', key_results: [keyResult({ current: 0 })] }),
      ]),
    ).goals;
    expect(settled.map((item) => isAtRisk(item, '2026-12-20'))).toEqual([false, false]);
  });
});

describe('四半期のグルーピングと focusQuarter', () => {
  const parsed = parse(
    goalsFile([
      goal({ id: 'g-q4', quarter: '2026-Q4' }),
      goal({ id: 'g-q1', quarter: '2027-Q1' }),
    ]),
  );

  it('新しい四半期が先頭に来る', () => {
    const model = buildGoalsModel(parsed, '2026-10-11');
    expect(model.quarters.map((group) => group.quarter)).toEqual(['2027-Q1', '2026-Q4']);
  });

  it('基準日の四半期があればそれを使う', () => {
    expect(pickFocusQuarter(parsed.goals, '2027-02-01')).toBe('2027-Q1');
  });

  it('基準日の四半期に目標がなければ直近の過去の四半期を使う', () => {
    expect(pickFocusQuarter(parsed.goals, '2027-05-01')).toBe('2027-Q1');
  });

  it('基準日より後の四半期しかなければ最古の四半期を使う', () => {
    expect(pickFocusQuarter(parsed.goals, '2026-01-01')).toBe('2026-Q4');
  });

  it('グループの進捗はその四半期だけを対象にする', () => {
    const model = buildGoalsModel(
      parse(
        goalsFile([
          goal({ id: 'g-q4', quarter: '2026-Q4', key_results: [keyResult({ target: 10, current: 10 })] }),
          goal({ id: 'g-q1', quarter: '2027-Q1', key_results: [keyResult({ target: 10, current: 0 })] }),
        ]),
      ),
      '2026-10-11',
    );
    expect(groupByQuarter(model.goals).map((group) => group.progress)).toEqual([0, 1]);
  });
});

describe('モデル全体', () => {
  const model = buildGoalsModel(
    parse(
      goalsFile([
        goal({
          id: 'g-a',
          skills: ['infra-terraform', 'cloud-aws'],
          key_results: [keyResult({ target: 10, current: 2 })],
        }),
        goal({ id: 'g-b', status: 'done', skills: ['soft-writing'] }),
        goal({ id: 'g-c', status: 'dropped', skills: ['prac-performance'] }),
      ]),
    ),
    '2026-12-20',
  );

  it('referencedSkillIds が全ての参照元を出所付きで拾う', () => {
    expect(model.referencedSkillIds).toEqual([
      { id: 'infra-terraform', source: 'goals.yaml の g-a' },
      { id: 'cloud-aws', source: 'goals.yaml の g-a' },
      { id: 'soft-writing', source: 'goals.yaml の g-b' },
      { id: 'prac-performance', source: 'goals.yaml の g-c' },
    ]);
  });

  it('stats.all が全四半期・全 status の件数を持つ', () => {
    expect(model.stats.all).toEqual({
      total: 3,
      done: 1,
      inProgress: 1,
      notStarted: 0,
      dropped: 1,
      atRisk: 1,
      stale: 0,
    });
  });

  it('stats.focus の分母は focusQuarter の dropped 以外だけ', () => {
    // 2026-Q4 の 3 件のうち dropped の g-c を外した 2 件が分母。
    expect(model.stats.focus).toMatchObject({ quarter: '2026-Q4', total: 2, done: 1, atRisk: 1 });
    // 対象は g-a (0.2) と g-b (1.0)。
    expect(model.stats.focus.progress).toBeCloseTo(0.6);
  });

  it('stats.overallProgress は focus.progress と同じ値（validate.ts への後方互換）', () => {
    expect(model.stats.overallProgress).toBe(model.stats.focus.progress);
  });

  it('ids が全目標 ID を持つ', () => {
    expect(model.ids).toEqual(['g-a', 'g-b', 'g-c']);
  });

  it('期末までの残日数を基準日から計算する', () => {
    expect(model.goals[0]!.daysToQuarterEnd).toBe(11);
  });
});

describe('過去四半期の扱い', () => {
  const model = buildGoalsModel(
    parse(
      goalsFile([
        goal({ id: 'g-past', quarter: '2026-Q3', key_results: [keyResult({ target: 10, current: 1 })] }),
        goal({ id: 'g-now', quarter: '2026-Q4', key_results: [keyResult({ target: 10, current: 1 })] }),
      ]),
    ),
    '2026-12-20',
  );

  it('過去四半期の未完了は atRisk ではなく stale に入る', () => {
    expect(model.atRisk.map((goal) => goal.id)).toEqual(['g-now']);
    expect(model.stale.map((goal) => goal.id)).toEqual(['g-past']);
    expect(model.stats.all.atRisk).toBe(1);
    expect(model.stats.all.stale).toBe(1);
  });

  it('HTML に「期間が終わった未確定の目標」セクションが出る', () => {
    const html = renderGoalsPage(model, 'x');
    expect(html).toContain('期間が終わった未確定の目標');
    expect(html).toContain('badge badge--warn">期間終了');
  });

  it('stale が無ければそのセクションは出ない', () => {
    const fresh = buildGoalsModel(parse(goalsFile([goal({ quarter: '2026-Q4' })])), '2026-10-11');
    expect(renderGoalsPage(fresh, 'x')).not.toContain('期間が終わった未確定の目標');
  });
});

describe('レンダラ', () => {
  const model = buildGoalsModel(
    parse(
      goalsFile([
        goal({
          id: 'g-xss',
          objective: '<script>alert("objective")</script>',
          why: '<img src=x onerror=alert(1)>',
          skills: ['lang-typescript'],
          key_results: [keyResult({ description: '<script>kr</script>', metric: '"m"&', target: 4, current: 1, unit: '件' })],
          retrospective: "<script>retro</script> & 'quote'",
        }),
      ]),
    ),
    '2026-12-20',
  );

  it('HTML ページが悪意ある文字列をエスケープする', () => {
    const html = renderGoalsPage(model, '2026-12-20 10:00 (JST)');
    expect(html).not.toContain('<script>');
    // エスケープ後は文字列として残るが、タグとして解釈される形では出現しない。
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;alert(&quot;objective&quot;)&lt;/script&gt;');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('ダッシュボードカードもエスケープする', () => {
    const card = renderGoalsCard(model);
    expect(card).not.toContain('<script>');
    expect(card.startsWith('    <section class="card">')).toBe(true);
  });

  it('HTML ページに進捗バーと status バッジが含まれる', () => {
    const html = renderGoalsPage(model, 'x');
    expect(html).toContain('class="bar-fill"');
    expect(html).toContain('badge badge--active');
    expect(html).toContain('badge badge--risk');
    expect(html).toContain('<span class="tag">lang-typescript</span>');
  });

  it('目標カードの見出しは四半期見出し (h2) の下の h3', () => {
    const html = renderGoalsPage(model, 'x');
    expect(html).toContain('<h2>2026-Q4 <span class="badge">');
    expect(html).toContain('<h3>&lt;script&gt;alert(&quot;objective&quot;)&lt;/script&gt;</h3>');
    expect(html).toContain('<h4>なぜやるのか</h4>');
    expect(html).toContain('<h4>Key Results</h4>');
    // 目標カード内に h2 を作らない（h2 → h2 の階層崩れを防ぐ）。
    expect(html).not.toContain('<h2>&lt;script&gt;');
  });

  it('達成率と件数のラベルに集計スコープが書かれている', () => {
    const html = renderGoalsPage(model, 'x');
    expect(html).toContain('2026-Q4 の達成率（対象 1 件 / 達成 0 件）');
    expect(html).toContain('全四半期の目標（達成 0 ・ 進行中 1 ・ 取りやめ 0）');

    const card = renderGoalsCard(model);
    expect(card).toContain('2026-Q4 の達成率（対象 1 件 / 達成 0 件）');

    const markdown = renderGoalsMarkdown(model);
    expect(markdown).toContain('2026-Q4: 達成率 **25%**（対象 1 件 / 達成 0 件）／全体 1 件');
  });

  it('Markdown が "## 目標" から始まる', () => {
    const markdown = renderGoalsMarkdown(model);
    expect(markdown.startsWith('## 目標')).toBe(true);
    expect(markdown).toContain('### 2026-Q4');
    expect(markdown).toContain('1件 / 4件');
  });
});

describe('テキスト整形', () => {
  it('日本語の改行を畳むときに余分な空白を入れない', () => {
    expect(oneLine('設計判断の理由を説明して\n再現できる状態にする')).toBe(
      '設計判断の理由を説明して再現できる状態にする',
    );
  });

  it('英単語の区切りでは空白を残す', () => {
    expect(oneLine('terraform plan\nand apply')).toBe('terraform plan and apply');
  });

  it('前後の空白と空行を落とす', () => {
    expect(oneLine('  a\n\n  b  ')).toBe('a b');
  });
});
