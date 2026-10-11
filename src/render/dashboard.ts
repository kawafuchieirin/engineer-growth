import { layout } from './layout.ts';

export interface DashboardInput {
  generatedAt: string;
  /**
   * レベルと XP のヒーロー（HTML 断片）。
   * 最初に目に入る位置に置く。「今どこまで来たか」が分からないと、
   * 下のカードはただの一覧になってしまう。
   */
  hero: string;
  /** 各領域のサマリカード（HTML 断片）。 */
  cards: string[];
}

export function renderDashboardPage({ generatedAt, hero, cards }: DashboardInput): string {
  return layout({
    title: 'Engineer Growth ダッシュボード',
    active: 'index',
    generatedAt,
    body: `  <h1>成長ダッシュボード</h1>
  <p class="lead">スキルの現在地・目標・ロードマップ・アウトプットを一枚で把握する。</p>
${hero}
  <div class="card-grid">
${cards.join('\n')}
  </div>`,
  });
}
