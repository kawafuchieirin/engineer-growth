import { describe, expect, it } from 'vitest';
import {
  assertGoalReferences,
  blockersOf,
  buildRoadmapModel,
  enumerateMonths,
  isOverdue,
  milestoneProgress,
  referencedGoalIds,
  stepProgress,
} from '../src/lib/roadmap.ts';
import { GrowthError } from '../src/lib/errors.ts';
import { roadmapFileSchema } from '../src/schema/roadmap.ts';
import { renderRoadmapCard, renderRoadmapMarkdown, renderRoadmapPage } from '../src/render/roadmap.ts';

/** safeParse の失敗メッセージを 1 本の文字列にまとめる。 */
function issueMessages(result: { success: boolean; error?: { issues: Array<{ message: string }> } }): string {
  return (result.error?.issues ?? []).map((issue) => issue.message).join(' | ');
}

function milestone(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'm-sample',
    title: 'サンプルのマイルストーン',
    track: 'infra',
    status: 'planned',
    start: '2026-10-01',
    due: '2026-11-30',
    skills: ['infra-terraform'],
    outcome: 'これができたら完了',
    steps: [{ description: '何かやる', done: false }],
    ...overrides,
  };
}

function roadmapFile(
  milestones: Array<Record<string, unknown>>,
  tracks: Array<Record<string, unknown>> = [{ id: 'infra', name: 'インフラ / SRE' }],
): Record<string, unknown> {
  return { updated: '2026-10-11', tracks, milestones };
}

/** フィクスチャもスキーマを通す。実データと同じ経路を通ることを保証するため。 */
function parse(file: Record<string, unknown>) {
  return roadmapFileSchema.parse(file);
}

describe('スキーマ検証', () => {
  it('start > due をエラーにする', () => {
    const result = roadmapFileSchema.safeParse(
      roadmapFile([milestone({ start: '2026-12-01', due: '2026-11-30' })]),
    );
    expect(result.success).toBe(false);
    expect(issueMessages(result)).toContain('start (2026-12-01) が due (2026-11-30) より後');
  });

  it('start === due は許す（1 日で終わるマイルストーン）', () => {
    expect(
      roadmapFileSchema.safeParse(roadmapFile([milestone({ start: '2026-10-01', due: '2026-10-01' })])).success,
    ).toBe(true);
  });

  it('未知の track を参照したらエラーになる', () => {
    const result = roadmapFileSchema.safeParse(roadmapFile([milestone({ track: 'unknown-track' })]));
    expect(result.success).toBe(false);
    expect(issueMessages(result)).toContain('未定義の track "unknown-track"');
  });

  it('存在しない depends_on をエラーにする', () => {
    const result = roadmapFileSchema.safeParse(
      roadmapFile([milestone({ depends_on: ['m-ghost'] })]),
    );
    expect(result.success).toBe(false);
    expect(issueMessages(result)).toContain('存在しないマイルストーン "m-ghost"');
  });

  it('循環依存 (a → b → a) をエラーにする', () => {
    const result = roadmapFileSchema.safeParse(
      roadmapFile([
        milestone({ id: 'm-a', depends_on: ['m-b'] }),
        milestone({ id: 'm-b', depends_on: ['m-a'] }),
      ]),
    );
    expect(result.success).toBe(false);
    expect(issueMessages(result)).toContain('depends_on が循環しています');
  });

  it('3 要素の循環依存 (a → b → c → a) も検出する', () => {
    const result = roadmapFileSchema.safeParse(
      roadmapFile([
        milestone({ id: 'm-a', depends_on: ['m-b'] }),
        milestone({ id: 'm-b', depends_on: ['m-c'] }),
        milestone({ id: 'm-c', depends_on: ['m-a'] }),
      ]),
    );
    expect(result.success).toBe(false);
    expect(issueMessages(result)).toContain('循環');
  });

  it('自己依存をエラーにする', () => {
    const result = roadmapFileSchema.safeParse(roadmapFile([milestone({ id: 'm-a', depends_on: ['m-a'] })]));
    expect(result.success).toBe(false);
    expect(issueMessages(result)).toContain('自分自身に依存');
  });

  it('マイルストーン id の重複を検出する', () => {
    const result = roadmapFileSchema.safeParse(
      roadmapFile([milestone({ id: 'm-a' }), milestone({ id: 'm-a' })]),
    );
    expect(result.success).toBe(false);
    expect(issueMessages(result)).toContain('"m-a" が重複');
  });

  it('status が blocked なら blocked_reason を要求する', () => {
    expect(roadmapFileSchema.safeParse(roadmapFile([milestone({ status: 'blocked' })])).success).toBe(false);
    expect(
      roadmapFileSchema.safeParse(
        roadmapFile([milestone({ status: 'blocked', blocked_reason: '別チームの決定待ち' })]),
      ).success,
    ).toBe(true);
  });

  it('status は列挙値以外を受け付けない', () => {
    expect(roadmapFileSchema.safeParse(roadmapFile([milestone({ status: 'waiting' })])).success).toBe(false);
  });

  it('id が kebab-case でなければエラーになる', () => {
    const result = roadmapFileSchema.safeParse(roadmapFile([milestone({ id: 'M_1' })]));
    expect(result.success).toBe(false);
    expect(issueMessages(result)).toContain('kebab-case');
  });

  it('未知のキーを許さない（タイポを見逃さない）', () => {
    expect(roadmapFileSchema.safeParse(roadmapFile([milestone({ dependsOn: ['m-x'] })])).success).toBe(false);
  });
});

describe('overdue 判定', () => {
  const planned = parse(roadmapFile([milestone({ due: '2026-11-30' })])).milestones[0]!;
  const finished = parse(roadmapFile([milestone({ status: 'done', due: '2026-11-30' })])).milestones[0]!;

  it('渡した「今日」に対して決定的に判定する', () => {
    expect(isOverdue(planned, '2026-11-30')).toBe(false);
    expect(isOverdue(planned, '2026-12-01')).toBe(true);
    expect(isOverdue(planned, '2026-10-01')).toBe(false);
  });

  it('done は期限を過ぎても overdue にしない', () => {
    expect(isOverdue(finished, '2027-01-01')).toBe(false);
  });
});

describe('steps と依存の集計', () => {
  it('steps の完了率を計算する', () => {
    const parsed = parse(
      roadmapFile([
        milestone({
          steps: [
            { description: 'a', done: true },
            { description: 'b', done: true },
            { description: 'c', done: false },
            { description: 'd', done: false },
          ],
        }),
      ]),
    );
    expect(stepProgress(parsed.milestones[0]!)).toBe(0.5);
  });

  it('status が done なら steps が残っていても進捗 1', () => {
    const parsed = parse(
      roadmapFile([
        milestone({ status: 'done', steps: [{ description: 'a', done: false }] }),
      ]),
    );
    expect(stepProgress(parsed.milestones[0]!)).toBe(0);
    expect(milestoneProgress(parsed.milestones[0]!)).toBe(1);
  });

  it('未完了の依存だけをブロッカーとして返す', () => {
    const statuses = new Map([
      ['m-done', 'done' as const],
      ['m-todo', 'planned' as const],
    ]);
    const parsed = parse(
      roadmapFile([
        milestone({ id: 'm-done', status: 'done' }),
        milestone({ id: 'm-todo' }),
        milestone({ id: 'm-target', depends_on: ['m-done', 'm-todo'] }),
      ]),
    );
    expect(blockersOf(parsed.milestones[2]!, statuses)).toEqual(['m-todo']);
  });

  it('自分が done なら依存先が未完了でもブロッカーは空', () => {
    // 完了済みに「待ち」は存在しない。残すと「手当てが必要」一覧に完了済みが並ぶ。
    const statuses = new Map([['m-todo', 'planned' as const]]);
    const parsed = parse(
      roadmapFile([
        milestone({ id: 'm-todo' }),
        milestone({ id: 'm-target', status: 'done', depends_on: ['m-todo'] }),
      ]),
    );
    expect(blockersOf(parsed.milestones[1]!, statuses)).toEqual([]);
  });
});

describe('月の列挙', () => {
  it('年をまたいで開始月から終了月までを列挙する', () => {
    expect(enumerateMonths('2026-11-15', '2027-02-01')).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
  });

  it('同じ月なら 1 要素', () => {
    expect(enumerateMonths('2026-10-01', '2026-10-31')).toEqual(['2026-10']);
  });
});

describe('目標 ID の参照整合性', () => {
  it('referencedGoalIds が参照元を出所付きで拾う', () => {
    const parsed = parse(
      roadmapFile([
        milestone({ id: 'm-a', goals: ['g-one', 'g-two'] }),
        milestone({ id: 'm-b' }),
        milestone({ id: 'm-c', goals: ['g-one'] }),
      ]),
    );
    expect(referencedGoalIds(parsed.milestones)).toEqual([
      { id: 'g-one', source: 'roadmap.yaml の m-a' },
      { id: 'g-two', source: 'roadmap.yaml の m-a' },
      { id: 'g-one', source: 'roadmap.yaml の m-c' },
    ]);
  });

  it('存在しない目標を参照していたら GrowthError', () => {
    const model = buildRoadmapModel(parse(roadmapFile([milestone({ goals: ['g-ghost'] })])), '2026-10-11');
    expect(() => assertGoalReferences(['g-real'], [model])).toThrow(GrowthError);
  });

  it('全て存在していれば通る', () => {
    const model = buildRoadmapModel(parse(roadmapFile([milestone({ goals: ['g-real'] })])), '2026-10-11');
    expect(() => assertGoalReferences(['g-real'], [model])).not.toThrow();
  });

  it('複数の参照元の問題をまとめて報告し、出所を本文に含める', () => {
    const model = buildRoadmapModel(
      parse(
        roadmapFile([
          milestone({ id: 'm-a', goals: ['g-ghost-a'] }),
          milestone({ id: 'm-b', goals: ['g-real', 'g-ghost-b'] }),
        ]),
      ),
      '2026-10-11',
    );
    // SkillReferencing と同形なので、参照元モデルを複数渡せる。
    const extra = { referencedGoalIds: [{ id: 'g-ghost-c', source: 'テストの別モデル' }] };
    try {
      assertGoalReferences(['g-real'], [model, extra]);
      throw new Error('GrowthError が投げられませんでした');
    } catch (error) {
      expect(error).toBeInstanceOf(GrowthError);
      const details = (error as GrowthError).details;
      expect(details).toEqual([
        'roadmap.yaml の m-a が未定義の目標 ID "g-ghost-a" を参照しています',
        'roadmap.yaml の m-b が未定義の目標 ID "g-ghost-b" を参照しています',
        'テストの別モデル が未定義の目標 ID "g-ghost-c" を参照しています',
      ]);
    }
  });
});

describe('モデル全体', () => {
  const file = parse(
    roadmapFile(
      [
        milestone({
          id: 'm-base',
          status: 'done',
          start: '2026-10-01',
          due: '2026-10-31',
          skills: ['infra-terraform', 'cloud-aws'],
          steps: [{ description: 'a', done: true }],
        }),
        milestone({
          id: 'm-late',
          status: 'in_progress',
          start: '2026-10-15',
          due: '2026-11-30',
          skills: ['infra-cicd'],
          depends_on: ['m-base'],
        }),
        milestone({
          id: 'm-waiting',
          track: 'design',
          status: 'blocked',
          blocked_reason: '別チーム待ち',
          start: '2026-11-01',
          due: '2027-01-31',
          skills: ['be-api-design'],
          depends_on: ['m-late'],
        }),
      ],
      [
        { id: 'infra', name: 'インフラ / SRE' },
        { id: 'design', name: '設計力' },
      ],
    ),
  );
  const model = buildRoadmapModel(file, '2026-12-15');

  it('マイルストーンを start 昇順に並べる', () => {
    expect(model.milestones.map((item) => item.id)).toEqual(['m-base', 'm-late', 'm-waiting']);
  });

  it('track ごとにマイルストーンをまとめ、表示名を解決する', () => {
    expect(model.tracks.map((track) => track.milestones.length)).toEqual([2, 1]);
    expect(model.milestones[2]!.trackName).toBe('設計力');
  });

  it('months が全マイルストーンの期間を覆う', () => {
    expect(model.months[0]).toBe('2026-10');
    expect(model.months.at(-1)).toBe('2027-01');
  });

  it('stats が status 別件数と遅延件数を持つ', () => {
    expect(model.stats).toMatchObject({ total: 3, done: 1, inProgress: 1, blocked: 1, planned: 0, overdue: 1 });
  });

  it('stats.completion は done/total、stats.progress は進捗の平均で別の値', () => {
    // done 1 / 全 3 件 = 1/3。平均進捗は m-base 1.0 + m-late 0 + m-waiting 0 の平均。
    expect(model.stats.completion).toBeCloseTo(1 / 3);
    expect(model.stats.progress).toBeCloseTo(1 / 3);
    expect(model.stats.completion).not.toBe(0.5);
  });

  it('未完了の依存をブロッカーとして持つ', () => {
    expect(model.milestones[1]!.blockers).toEqual([]);
    expect(model.milestones[2]!.blockers).toEqual(['m-late']);
  });

  it('referencedGoalIds は goals を持つマイルストーンだけを拾う', () => {
    expect(model.referencedGoalIds).toEqual([]);
  });

  it('referencedSkillIds が全ての参照元を出所付きで拾う', () => {
    expect(model.referencedSkillIds).toEqual([
      { id: 'infra-terraform', source: 'roadmap.yaml の m-base' },
      { id: 'cloud-aws', source: 'roadmap.yaml の m-base' },
      { id: 'infra-cicd', source: 'roadmap.yaml の m-late' },
      { id: 'be-api-design', source: 'roadmap.yaml の m-waiting' },
    ]);
  });
});

describe('レンダラ', () => {
  const model = buildRoadmapModel(
    parse(
      roadmapFile([
        milestone({
          id: 'm-xss',
          title: '<script>alert("title")</script>',
          outcome: '<img src=x onerror=alert(1)>',
          blocked_reason: '<b>理由</b> & "引用"',
          status: 'blocked',
          steps: [{ description: "<script>step</script>", done: true }],
          goals: ['g-x'],
        }),
      ]),
    ),
    '2026-12-15',
  );

  it('HTML ページが悪意ある文字列をエスケープする（SVG のテキストも含む）', () => {
    const html = renderRoadmapPage(model, '2026-12-15 10:00 (JST)');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<b>理由');
    expect(html).toContain('&lt;script&gt;alert(&quot;title&quot;)&lt;/script&gt;');
  });

  it('ダッシュボードカードもエスケープする', () => {
    const card = renderRoadmapCard(model);
    expect(card).not.toContain('<script>');
    expect(card.startsWith('    <section class="card">')).toBe(true);
  });

  it('ガントチャートが inline SVG として出力される', () => {
    const html = renderRoadmapPage(model, 'x');
    expect(html).toContain('<svg class="chart"');
    expect(html).toContain('viewBox="0 0 ');
    expect(html).toContain('</svg>');
    // status ごとの色分けと凡例。
    expect(html).toContain('fill:var(--danger)');
    expect(html).toContain('予定</text>');
  });

  it('timeline と遅延・ブロック表示を含む', () => {
    const html = renderRoadmapPage(model, 'x');
    expect(html).toContain('<ul class="timeline">');
    expect(html).toContain('class="timeline-item"');
    expect(html).toContain('badge badge--risk');
    expect(html).toContain('遅延');
  });

  it('完了済みマイルストーンは「待ち」バッジも手当て一覧も出ない', () => {
    const withDone = buildRoadmapModel(
      parse(
        roadmapFile([
          milestone({ id: 'm-todo', title: '未完了の依存先' }),
          milestone({
            id: 'm-finished',
            title: '終わったマイルストーン',
            status: 'done',
            depends_on: ['m-todo'],
            steps: [{ description: 'a', done: true }],
          }),
        ]),
      ),
      '2026-10-15',
    );
    const html = renderRoadmapPage(withDone, 'x');
    expect(html).not.toContain('待ち: m-todo');
    // 手当て一覧は空（完了済みの m-finished も、依存されているだけの m-todo も対象外）。
    expect(html).toContain('遅延・ブロック中のマイルストーンはありません。');
    expect(renderRoadmapMarkdown(withDone)).not.toContain('未完了の依存: `m-todo`');
  });

  it('カードのバーは完了率（done/total）で、平均進捗は文章で添える', () => {
    const html = renderRoadmapPage(model, 'x');
    // 1 件・未完了なので完了率 0%、ステップ完了率は 100%。
    expect(html).toContain('バー = 完了率 0%（0/1）・ステップを含めた平均進捗 100%');
    expect(html).toContain('style="width:0%"');
  });

  it('Markdown が "## ロードマップ" から始まる', () => {
    const markdown = renderRoadmapMarkdown(model);
    expect(markdown.startsWith('## ロードマップ')).toBe(true);
    expect(markdown).toContain('### インフラ / SRE');
    expect(markdown).toContain('ステップ 1/1');
  });
});
