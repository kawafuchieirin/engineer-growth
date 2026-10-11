import type { GoalStatus } from '../schema/goals.ts';
import type { GoalView, GoalsModel, QuarterGroup } from '../lib/goals.ts';
import { escapeHtml, layout } from './layout.ts';

/** status の表示名とバッジのクラス。表示の決め方を 1 箇所に集める。 */
const STATUS_STYLE: Record<GoalStatus, { label: string; badge: string }> = {
  not_started: { label: '未着手', badge: 'badge' },
  in_progress: { label: '進行中', badge: 'badge badge--active' },
  done: { label: '達成', badge: 'badge badge--done' },
  dropped: { label: '取りやめ', badge: 'badge badge--warn' },
};

/*
 * 以下のテキスト整形ヘルパは src/render/roadmap.ts からも使う。
 * 共有基盤（src/render/layout.ts）は本領域の所有物ではないため、
 * 重複を避ける置き場としてこちらを「正」にして roadmap 側から import する。
 */

export function percent(ratio: number): number {
  return Math.round(ratio * 100);
}

/** 進捗バー。幅はデータ由来なので inline style で与えるしかない（数値のみ埋め込む）。 */
export function bar(ratio: number): string {
  return `<div class="bar"><span class="bar-fill" style="width:${percent(ratio)}%"></span></div>`;
}

/**
 * 改行を畳んで 1 行にする。
 * 日本語の文中で改行を空白に置換すると「説明して 再現できる」のような
 * 不自然な隙間になるため、両側が ASCII（英単語の区切り）のときだけ空白を残す。
 */
export function oneLine(text: string): string {
  return text
    .trim()
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .reduce((joined, line) => {
      if (joined === '') return line;
      const needsSpace =
        /[A-Za-z0-9,.;:!?)\]]$/.test(joined) && /^[A-Za-z0-9(\[]/.test(line);
      return joined + (needsSpace ? ' ' : '') + line;
    }, '');
}

/** YAML のブロックスカラー（空行区切りのテキスト）を段落に変換する。必ずエスケープを通す。 */
export function paragraphs(text: string): string {
  return text
    .trim()
    .split(/\n{2,}/)
    .map((block) => `<p>${escapeHtml(oneLine(block))}</p>`)
    .join('\n');
}

function statusBadge(goal: GoalView): string {
  const style = STATUS_STYLE[goal.status];
  const badges = [`<span class="${style.badge}">${escapeHtml(style.label)}</span>`];
  if (goal.atRisk) badges.push('<span class="badge badge--risk">要注意</span>');
  // stale は「もう間に合わない」ので要注意（手当てを促す）とは別のバッジにする。
  if (goal.stale) badges.push('<span class="badge badge--warn">期間終了</span>');
  return badges.join(' ');
}

function keyResultRows(goal: GoalView): string {
  return goal.key_results
    .map((keyResult) => {
      const unit = keyResult.unit ? escapeHtml(keyResult.unit) : '';
      return `        <tr>
          <td>${escapeHtml(oneLine(keyResult.description))}</td>
          <td>${escapeHtml(oneLine(keyResult.metric))}</td>
          <td>${keyResult.current}${unit}</td>
          <td>${keyResult.target}${unit}</td>
          <td>${percent(keyResult.progress)}%<br>${bar(keyResult.progress)}</td>
        </tr>`;
    })
    .join('\n');
}

function goalSection(goal: GoalView): string {
  const deadline =
    goal.daysToQuarterEnd >= 0
      ? `期末まで ${goal.daysToQuarterEnd} 日`
      : `期末から ${Math.abs(goal.daysToQuarterEnd)} 日経過`;

  const retrospective = goal.retrospective
    ? `    <h4>振り返り</h4>
${paragraphs(goal.retrospective)}`
    : '';

  return `  <section class="card" id="${escapeHtml(goal.id)}">
    <h3>${escapeHtml(goal.objective)}</h3>
    <p>${statusBadge(goal)} <span class="metric-label">${escapeHtml(goal.quarter)} ・ ${escapeHtml(deadline)} ・ ${escapeHtml(goal.id)}</span></p>
    <div class="metric"><span class="metric-value">${percent(goal.progress)}%</span><span class="metric-label">進捗</span></div>
    ${bar(goal.progress)}
    <h4>なぜやるのか</h4>
${paragraphs(goal.why)}
    <h4>Key Results</h4>
    <div class="table-scroll">
      <table class="table">
        <thead><tr><th>Key Result</th><th>指標</th><th>現在</th><th>目標</th><th>進捗</th></tr></thead>
        <tbody>
${keyResultRows(goal)}
        </tbody>
      </table>
    </div>
    <h4>関連スキル</h4>
    <p>${goal.skills.map((id) => `<span class="tag">${escapeHtml(id)}</span>`).join('')}</p>
${retrospective}
  </section>`;
}

function quarterSection(group: QuarterGroup): string {
  return `  <h2>${escapeHtml(group.quarter)} <span class="badge">達成率 ${percent(group.progress)}%</span></h2>
${group.goals.map(goalSection).join('\n')}`;
}

function goalLinks(goals: ReadonlyArray<GoalView>, badge: string): string {
  return goals
    .map(
      (goal) =>
        `    <li>${badge} <a href="#${escapeHtml(goal.id)}">${escapeHtml(goal.objective)}</a> — ${escapeHtml(goal.quarter)} ・ 進捗 ${percent(goal.progress)}%</li>`,
    )
    .join('\n');
}

function atRiskSection(model: GoalsModel): string {
  if (model.atRisk.length === 0) {
    return `  <h2>要注意の目標</h2>
  <p class="empty">期末が近いのに進捗が遅れている目標はありません。</p>`;
  }
  return `  <h2>要注意の目標</h2>
  <p class="lead">期末まで残り少ないのに進捗が遅れている目標。やり切るか、落とすかを決める。</p>
  <ul>
${goalLinks(model.atRisk, '<span class="badge badge--risk">要注意</span>')}
  </ul>`;
}

/** 期末を過ぎたまま未確定の目標。手当てではなく「done / dropped に確定させる」ための一覧。 */
function staleSection(model: GoalsModel): string {
  if (model.stale.length === 0) return '';
  return `  <h2>期間が終わった未確定の目標</h2>
  <p class="lead">四半期が終わっているのに status が確定していない目標。達成なら done、やらないと決めたなら dropped に直し、<code>retrospective</code> を書く。</p>
  <ul>
${goalLinks(model.stale, '<span class="badge badge--warn">期間終了</span>')}
  </ul>`;
}

export function renderGoalsPage(model: GoalsModel, generatedAt: string): string {
  // 達成率（focusQuarter のみ・dropped 除外）と件数（全四半期・全 status）は分母が違う。
  // 分解して名前を付けておき、ラベルに必ずスコープを書く。
  const { focus, all } = model.stats;
  const body = `  <h1>目標 (OKR)</h1>
  <p class="lead">Objective は向きを、Key Result は測れる成果を表す。進捗は Key Result の数値から計算している。</p>

  <section class="card">
    <h2>ありたい姿</h2>
${paragraphs(model.horizon.vision)}
    <p class="metric-label">更新: ${escapeHtml(model.horizon.updated)}</p>
  </section>

  <div class="card-grid">
    <section class="card">
      <div class="metric"><span class="metric-value">${percent(focus.progress)}%</span><span class="metric-label">${escapeHtml(focus.quarter)} の達成率（対象 ${focus.total} 件 / 達成 ${focus.done} 件）</span></div>
      ${bar(focus.progress)}
    </section>
    <section class="card">
      <div class="metric"><span class="metric-value">${all.total}</span><span class="metric-label">全四半期の目標（達成 ${all.done} ・ 進行中 ${all.inProgress} ・ 取りやめ ${all.dropped}）</span></div>
    </section>
    <section class="card">
      <div class="metric"><span class="metric-value">${all.atRisk}</span><span class="metric-label">要注意（全四半期）・ 期間終了 ${all.stale} 件</span></div>
    </section>
  </div>

${atRiskSection(model)}
${staleSection(model)}

${model.quarters.map(quarterSection).join('\n\n')}`;

  return layout({ title: '目標 (OKR) | Engineer Growth', active: 'goals', generatedAt, body });
}

export function renderGoalsMarkdown(model: GoalsModel): string {
  const lines: string[] = ['## 目標', ''];
  lines.push(`**ありたい姿**: ${oneLine(model.horizon.vision)}`, '');
  const { focus, all } = model.stats;
  lines.push(
    `${focus.quarter}: 達成率 **${percent(focus.progress)}%**（対象 ${focus.total} 件 / 達成 ${focus.done} 件）` +
      `／全体 ${all.total} 件（達成 ${all.done} ・ 取りやめ ${all.dropped} ・ 要注意 ${all.atRisk} ・ 期間終了 ${all.stale}）`,
    '',
  );

  for (const group of model.quarters) {
    lines.push(`### ${group.quarter}（達成率 ${percent(group.progress)}%）`, '');
    for (const goal of group.goals) {
      const flags = [STATUS_STYLE[goal.status].label];
      if (goal.atRisk) flags.push('要注意');
      if (goal.stale) flags.push('期間終了');
      lines.push(`#### ${goal.objective}`, '');
      lines.push(`- 状態: ${flags.join(' / ')} ・ 進捗 ${percent(goal.progress)}%`);
      lines.push(`- なぜ: ${oneLine(goal.why)}`);
      lines.push(`- 関連スキル: ${goal.skills.map((id) => `\`${id}\``).join(', ')}`);
      lines.push('- Key Results:');
      for (const keyResult of goal.key_results) {
        const unit = keyResult.unit ?? '';
        lines.push(
          `  - ${oneLine(keyResult.description)} — ${keyResult.current}${unit} / ${keyResult.target}${unit}（${percent(keyResult.progress)}%）`,
        );
      }
      if (goal.retrospective) lines.push(`- 振り返り: ${oneLine(goal.retrospective)}`);
      lines.push('');
    }
  }
  return lines.join('\n').trimEnd();
}

export function renderGoalsCard(model: GoalsModel): string {
  const { focus } = model.stats;
  const highlights = model.quarters
    .flatMap((group) => group.goals)
    .filter((goal) => goal.status === 'in_progress' || goal.status === 'not_started')
    .slice(0, 3)
    .map(
      (goal) =>
        `      <li>${escapeHtml(goal.objective)} — ${percent(goal.progress)}%${goal.atRisk ? ' <span class="badge badge--risk">要注意</span>' : ''}${goal.stale ? ' <span class="badge badge--warn">期間終了</span>' : ''}</li>`,
    )
    .join('\n');

  const list = highlights
    ? `    <ul>
${highlights}
    </ul>`
    : '    <p class="empty">進行中の目標がありません。</p>';

  return `    <section class="card">
      <h2>目標 (OKR)</h2>
      <div class="metric"><span class="metric-value">${percent(focus.progress)}%</span><span class="metric-label">${escapeHtml(focus.quarter)} の達成率（対象 ${focus.total} 件 / 達成 ${focus.done} 件）</span></div>
      ${bar(focus.progress)}
${list}
      <p><a href="goals.html">目標の詳細を見る</a></p>
    </section>`;
}
