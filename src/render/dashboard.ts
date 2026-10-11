import { layout } from './layout.ts';

export interface DashboardInput {
  generatedAt: string;
  /** 各領域のサマリカード（HTML 断片）。 */
  cards: string[];
}

export function renderDashboardPage({ generatedAt, cards }: DashboardInput): string {
  return layout({
    title: 'Engineer Growth ダッシュボード',
    active: 'index',
    generatedAt,
    body: `  <h1>成長ダッシュボード</h1>
  <p class="lead">スキルの現在地・目標・ロードマップ・アウトプットを一枚で把握する。</p>
  <div class="card-grid">
${cards.join('\n')}
  </div>`,
  });
}
