import { describe, expect, it } from 'vitest';
import { buildRoadmapModel } from '../src/lib/roadmap.ts';
import { roadmapFileSchema } from '../src/schema/roadmap.ts';
import { renderRoadmapPage } from '../src/render/roadmap.ts';

/**
 * 依存関係図（flowChart）の振る舞いを検証する。
 *
 * flowChart は非公開なので、ページ全体の出力から図の部分だけを切り出して見る。
 * 実装の内部ではなく「図に何が描かれるか」を検証対象にする。
 */

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

function roadmapFile(milestones: Array<Record<string, unknown>>): Record<string, unknown> {
  return {
    updated: '2026-10-11',
    tracks: [{ id: 'infra', name: 'インフラ / SRE' }],
    milestones,
  };
}

/** ページを描画し、依存関係図の svg だけを返す。 */
function flowSvg(milestones: Array<Record<string, unknown>>, today = '2026-10-15'): string {
  const model = buildRoadmapModel(roadmapFileSchema.parse(roadmapFile(milestones)), today);
  const html = renderRoadmapPage(model, '2026-10-15');
  const match = /<svg class="chart"[^>]*aria-label="マイルストーンの依存関係図"[\s\S]*?<\/svg>/.exec(
    html,
  );
  if (!match) throw new Error('依存関係図が描画されていない');
  return match[0];
}

function count(svg: string, pattern: RegExp): number {
  return svg.match(pattern)?.length ?? 0;
}

/** ノードの矩形（角丸 6）の数 = マイルストーンの数。 */
const NODE_RECT = /<rect[^>]*rx="6"/g;
/** 依存を結ぶ曲線。 */
const EDGE_PATH = /<path d="M [\d.]+ [\d.]+ C /g;

describe('依存関係図', () => {
  it('マイルストーンの数だけノードを描く', () => {
    const svg = flowSvg([
      milestone({ id: 'm-a', title: 'A' }),
      milestone({ id: 'm-b', title: 'B' }),
      milestone({ id: 'm-c', title: 'C' }),
    ]);
    expect(count(svg, NODE_RECT)).toBe(3);
  });

  it('depends_on の数だけ線を引く', () => {
    const svg = flowSvg([
      milestone({ id: 'm-a', title: 'A' }),
      milestone({ id: 'm-b', title: 'B', depends_on: ['m-a'] }),
      milestone({ id: 'm-c', title: 'C', depends_on: ['m-a', 'm-b'] }),
    ]);
    expect(count(svg, EDGE_PATH)).toBe(3);
  });

  it('依存が深いものほど右に置く', () => {
    const svg = flowSvg([
      milestone({ id: 'm-a', title: 'A' }),
      milestone({ id: 'm-b', title: 'B', depends_on: ['m-a'] }),
      milestone({ id: 'm-c', title: 'C', depends_on: ['m-b'] }),
    ]);
    const xs = [...svg.matchAll(/<rect x="(\d+)"[^>]*rx="6"/g)].map((m) => Number(m[1]));
    expect(xs).toHaveLength(3);
    // 段が進むごとに x が増える（同じ段に 2 つ以上無いフィクスチャなので厳密に増加する）
    expect(xs[1]).toBeGreaterThan(xs[0] as number);
    expect(xs[2]).toBeGreaterThan(xs[1] as number);
  });

  it('依存が済んでいない線は破線にする', () => {
    const blocked = flowSvg([
      milestone({ id: 'm-a', title: 'A', status: 'planned' }),
      milestone({ id: 'm-b', title: 'B', depends_on: ['m-a'] }),
    ]);
    const cleared = flowSvg([
      milestone({ id: 'm-a', title: 'A', status: 'done' }),
      milestone({ id: 'm-b', title: 'B', depends_on: ['m-a'] }),
    ]);
    // 凡例にも破線が 1 本あるので、本数の差で判定する
    expect(count(blocked, /stroke-dasharray:5 4/g)).toBeGreaterThan(
      count(cleared, /stroke-dasharray:5 4/g),
    );
  });

  it('今着手できる件数を説明文に出す', () => {
    // m-a は依存なしで未完了 → 着手できる。m-b は m-a 待ち → できない。
    const svg = flowSvg([
      milestone({ id: 'm-a', title: 'A' }),
      milestone({ id: 'm-b', title: 'B', depends_on: ['m-a'] }),
    ]);
    const model = buildRoadmapModel(
      roadmapFileSchema.parse(
        roadmapFile([
          milestone({ id: 'm-a', title: 'A' }),
          milestone({ id: 'm-b', title: 'B', depends_on: ['m-a'] }),
        ]),
      ),
      '2026-10-15',
    );
    const html = renderRoadmapPage(model, '2026-10-15');
    expect(html).toContain('いま着手できるのは 1 件');
    // 図そのものは描けている
    expect(count(svg, NODE_RECT)).toBe(2);
  });

  it('完了したマイルストーンは着手できる件数に数えない', () => {
    const model = buildRoadmapModel(
      roadmapFileSchema.parse(
        roadmapFile([
          milestone({ id: 'm-a', title: 'A', status: 'done', steps: [{ description: 'x', done: true }] }),
          milestone({ id: 'm-b', title: 'B' }),
        ]),
      ),
      '2026-10-15',
    );
    expect(renderRoadmapPage(model, '2026-10-15')).toContain('いま着手できるのは 1 件');
  });

  it('未定義の依存先はスキーマが弾くので、図には届かない', () => {
    // 描画側にも未定義依存のガードはあるが、それは「将来 model の一部だけを
    // 渡す呼び出しが出たとき」のための保険。通常の経路ではここで止まる。
    expect(() =>
      roadmapFileSchema.parse(
        roadmapFile([milestone({ id: 'm-a', title: 'A', depends_on: ['m-ghost'] })]),
      ),
    ).toThrow(/存在しないマイルストーン/);
  });

  it('タイトルは打ち切るが、全文を title 要素に残す', () => {
    const long = 'とても長いマイルストーンの名前がここに入る';
    const svg = flowSvg([milestone({ id: 'm-a', title: long })]);
    expect(svg).toContain('…');
    expect(svg).toContain(long);
  });

  it('座標と寸法に NaN や Infinity を出さない', () => {
    const svg = flowSvg([
      milestone({ id: 'm-a', title: 'A' }),
      milestone({ id: 'm-b', title: 'B', depends_on: ['m-a'] }),
      milestone({ id: 'm-c', title: 'C', depends_on: ['m-a'] }),
      milestone({ id: 'm-d', title: 'D', depends_on: ['m-b', 'm-c'] }),
    ]);
    for (const bad of ['NaN', 'Infinity', 'undefined', 'null']) {
      expect(svg).not.toContain(bad);
    }
  });
});
