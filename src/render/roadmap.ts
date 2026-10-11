import type { MilestoneStatus } from '../schema/roadmap.ts';
import type { MilestoneView, RoadmapModel, TrackView } from '../lib/roadmap.ts';
// テキスト整形ヘルパは goals 側を正として共用する（重複定義を避けるため）。
import { bar, oneLine, paragraphs, percent } from './goals.ts';
import { escapeHtml, layout } from './layout.ts';

/** status の表示名・バッジ・ガントチャートの塗り。表示の決め方を 1 箇所に集める。 */
const STATUS_STYLE: Record<MilestoneStatus, { label: string; badge: string; fill: string }> = {
  // fill は :root のトークンを参照する。生の色を書かないことでダークモードに追従する。
  planned: { label: '予定', badge: 'badge', fill: 'fill:var(--text-muted);opacity:0.45' },
  in_progress: { label: '進行中', badge: 'badge badge--active', fill: 'fill:var(--accent)' },
  done: { label: '完了', badge: 'badge badge--done', fill: 'fill:var(--success)' },
  blocked: { label: 'ブロック中', badge: 'badge badge--risk', fill: 'fill:var(--danger)' },
};

/** ガントチャートの寸法（SVG ユーザー単位）。viewBox でスケールするので実寸ではない。 */
const LABEL_WIDTH = 196;
const MONTH_WIDTH = 54;
const ROW_HEIGHT = 26;
const TRACK_HEADER_HEIGHT = 28;
const AXIS_HEIGHT = 40;
const LEGEND_HEIGHT = 34;
const BAR_HEIGHT = 14;
const CHART_PADDING = 8;
/** マイルストーン名のラベルはこの文字数で打ち切る（はみ出しを防ぐ。全文は <title> で出す）。 */
const LABEL_MAX_CHARS = 13;

function truncate(text: string, max: number): string {
  const normalized = oneLine(text);
  return normalized.length > max ? `${normalized.slice(0, max)}…` : normalized;
}

/** その月の日数。翌月 0 日 = 当月末日。 */
function daysInMonth(month: string): number {
  return new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
}

/**
 * 日付の X 座標。月単位の格子の中を日割りで按分する。
 * inclusive = true は「その日の終わり」を指す（due をバーに含めるため）。
 */
function dateX(months: ReadonlyArray<string>, date: string, inclusive = false): number {
  const month = date.slice(0, 7);
  const index = months.indexOf(month);
  // 範囲外（months は start〜due を覆うので通常起きない）は端にクランプする。
  if (index < 0) return month < (months[0] ?? month) ? LABEL_WIDTH : LABEL_WIDTH + months.length * MONTH_WIDTH;
  const day = Number(date.slice(8, 10)) - (inclusive ? 0 : 1);
  return LABEL_WIDTH + (index + day / daysInMonth(month)) * MONTH_WIDTH;
}

interface ChartRow {
  readonly kind: 'track' | 'milestone';
  readonly track?: TrackView;
  readonly milestone?: MilestoneView;
}

/** 手書きの inline SVG ガントチャート。外部ライブラリを使わない方針のため自前で組む。 */
function ganttChart(model: RoadmapModel): string {
  const months = model.months;
  const rows: ChartRow[] = model.tracks
    .filter((track) => track.milestones.length > 0)
    .flatMap((track) => [
      { kind: 'track' as const, track },
      ...track.milestones.map((milestone) => ({ kind: 'milestone' as const, milestone })),
    ]);

  const width = LABEL_WIDTH + months.length * MONTH_WIDTH + CHART_PADDING;
  const bodyHeight = rows.reduce(
    (sum, row) => sum + (row.kind === 'track' ? TRACK_HEADER_HEIGHT : ROW_HEIGHT),
    0,
  );
  const height = AXIS_HEIGHT + bodyHeight + LEGEND_HEIGHT;

  const parts: string[] = [];

  // --- 横軸（年・月ラベルと月境界の罫線） ---
  months.forEach((month, index) => {
    const x = LABEL_WIDTH + index * MONTH_WIDTH;
    parts.push(
      `    <line x1="${x}" y1="${AXIS_HEIGHT - 14}" x2="${x}" y2="${AXIS_HEIGHT + bodyHeight}" style="stroke:var(--border);stroke-width:1"></line>`,
    );
    parts.push(
      `    <text x="${x + MONTH_WIDTH / 2}" y="${AXIS_HEIGHT - 4}" text-anchor="middle" style="fill:var(--text-muted);font-size:11px">${escapeHtml(month.slice(5))}月</text>`,
    );
    if (index === 0 || month.endsWith('-01')) {
      parts.push(
        `    <text x="${x + 2}" y="${AXIS_HEIGHT - 22}" style="fill:var(--text-muted);font-size:11px;font-weight:600">${escapeHtml(month.slice(0, 4))}</text>`,
      );
    }
  });
  const axisEnd = LABEL_WIDTH + months.length * MONTH_WIDTH;
  parts.push(
    `    <line x1="${axisEnd}" y1="${AXIS_HEIGHT - 14}" x2="${axisEnd}" y2="${AXIS_HEIGHT + bodyHeight}" style="stroke:var(--border);stroke-width:1"></line>`,
  );

  // --- 行（トラック見出し＋マイルストーンのバー） ---
  let y = AXIS_HEIGHT;
  for (const row of rows) {
    if (row.kind === 'track' && row.track) {
      parts.push(
        `    <text x="0" y="${y + 19}" style="fill:var(--text);font-size:12px;font-weight:700">${escapeHtml(row.track.name)}</text>`,
      );
      y += TRACK_HEADER_HEIGHT;
      continue;
    }
    const milestone = row.milestone;
    if (!milestone) continue;

    const barY = y + (ROW_HEIGHT - BAR_HEIGHT) / 2;
    const x1 = dateX(months, milestone.start);
    const x2 = dateX(months, milestone.due, true);
    // 同日開始・終了でもバーが消えないよう最小幅を確保する。
    const barWidth = Math.max(x2 - x1, 3);
    const style = STATUS_STYLE[milestone.status];
    const outline = milestone.overdue
      ? ';stroke:var(--danger);stroke-width:2;stroke-dasharray:4 3'
      : '';

    parts.push(
      `    <text x="12" y="${y + 17}" style="fill:var(--text-muted);font-size:11px">${escapeHtml(truncate(milestone.title, LABEL_MAX_CHARS))}</text>`,
    );
    parts.push(
      `    <rect x="${x1.toFixed(1)}" y="${barY}" width="${barWidth.toFixed(1)}" height="${BAR_HEIGHT}" rx="4" style="${style.fill}${outline}"><title>${escapeHtml(
        `${milestone.title}（${style.label}${milestone.overdue ? ' / 遅延' : ''}） ${milestone.start} 〜 ${milestone.due} ・ 進捗 ${percent(milestone.progress)}%`,
      )}</title></rect>`,
    );
    y += ROW_HEIGHT;
  }

  // --- 今日の位置 ---
  const todayMonth = model.today.slice(0, 7);
  if (months.includes(todayMonth)) {
    const todayX = dateX(months, model.today);
    parts.push(
      `    <line x1="${todayX.toFixed(1)}" y1="${AXIS_HEIGHT - 14}" x2="${todayX.toFixed(1)}" y2="${AXIS_HEIGHT + bodyHeight}" style="stroke:var(--accent);stroke-width:2;stroke-dasharray:3 2"></line>`,
    );
    parts.push(
      `    <text x="${(todayX + 4).toFixed(1)}" y="${AXIS_HEIGHT + bodyHeight + 12}" style="fill:var(--accent);font-size:11px">今日 ${escapeHtml(model.today)}</text>`,
    );
  }

  // --- 凡例 ---
  const legendY = AXIS_HEIGHT + bodyHeight + LEGEND_HEIGHT - 10;
  let legendX = LABEL_WIDTH;
  for (const status of Object.keys(STATUS_STYLE) as MilestoneStatus[]) {
    const style = STATUS_STYLE[status];
    parts.push(
      `    <rect x="${legendX}" y="${legendY - 9}" width="12" height="12" rx="3" style="${style.fill}"></rect>`,
    );
    parts.push(
      `    <text x="${legendX + 17}" y="${legendY}" style="fill:var(--text-muted);font-size:11px">${escapeHtml(style.label)}</text>`,
    );
    legendX += 17 + style.label.length * 12 + 14;
  }

  return `  <svg class="chart" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="マイルストーンのガントチャート">
    <title>マイルストーンのガントチャート</title>
    <desc>トラックごとのマイルストーンを開始日から期限までの横バーで表した図。</desc>
${parts.join('\n')}
  </svg>
  <p class="chart-caption">トラック別マイルストーン（${escapeHtml(model.months[0] ?? '')} 〜 ${escapeHtml(model.months.at(-1) ?? '')}）</p>`;
}

function milestoneBadges(milestone: MilestoneView): string {
  const style = STATUS_STYLE[milestone.status];
  const badges = [`<span class="${style.badge}">${escapeHtml(style.label)}</span>`];
  if (milestone.overdue) badges.push('<span class="badge badge--risk">遅延</span>');
  if (milestone.blockers.length > 0) {
    badges.push(
      `<span class="badge badge--warn">待ち: ${escapeHtml(milestone.blockers.join(', '))}</span>`,
    );
  }
  return badges.join(' ');
}

function milestoneItem(milestone: MilestoneView): string {
  const steps = milestone.steps
    .map(
      (step) =>
        `        <li>${step.done ? '✓' : '○'} ${escapeHtml(oneLine(step.description))}</li>`,
    )
    .join('\n');

  const goals =
    milestone.goals && milestone.goals.length > 0
      ? `      <p class="metric-label">関連目標: ${milestone.goals
          .map((id) => `<a href="goals.html#${escapeHtml(id)}">${escapeHtml(id)}</a>`)
          .join(' ')}</p>`
      : '';

  const blockedReason = milestone.blocked_reason
    ? `      <p><span class="badge badge--risk">ブロック理由</span> ${escapeHtml(oneLine(milestone.blocked_reason))}</p>`
    : '';

  return `    <li class="timeline-item" id="${escapeHtml(milestone.id)}">
      <p class="timeline-item__date">${escapeHtml(milestone.start)} 〜 ${escapeHtml(milestone.due)} ・ ステップ ${milestone.stepsDone}/${milestone.stepsTotal}</p>
      <h3>${escapeHtml(milestone.title)}</h3>
      <p>${milestoneBadges(milestone)}</p>
      ${bar(milestone.progress)}
${blockedReason}
      <p><strong>達成状態</strong></p>
${paragraphs(milestone.outcome)}
      <ul>
${steps}
      </ul>
      <p>${milestone.skills.map((id) => `<span class="tag">${escapeHtml(id)}</span>`).join('')}</p>
${goals}
    </li>`;
}

function trackSection(track: TrackView): string {
  if (track.milestones.length === 0) {
    return `  <h2>${escapeHtml(track.name)}</h2>
  <p class="empty">このトラックにはまだマイルストーンがありません。</p>`;
  }
  return `  <h2>${escapeHtml(track.name)}</h2>
  <ul class="timeline">
${track.milestones.map(milestoneItem).join('\n')}
  </ul>`;
}

/** 遅延・ブロック中を 1 箇所に集める。放置されたものを目に入れるのが目的。 */
function attentionSection(model: RoadmapModel): string {
  const needsAttention = model.milestones.filter(
    (milestone) => milestone.overdue || milestone.status === 'blocked' || milestone.blockers.length > 0,
  );
  if (needsAttention.length === 0) {
    return `  <h2>手当てが必要なマイルストーン</h2>
  <p class="empty">遅延・ブロック中のマイルストーンはありません。</p>`;
  }
  const items = needsAttention
    .map((milestone) => {
      const reasons: string[] = [];
      if (milestone.overdue) reasons.push(`期限 ${milestone.due} を超過`);
      if (milestone.blocked_reason) reasons.push(oneLine(milestone.blocked_reason));
      if (milestone.blockers.length > 0) reasons.push(`未完了の依存: ${milestone.blockers.join(', ')}`);
      return `    <li>${milestoneBadges(milestone)} <a href="#${escapeHtml(milestone.id)}">${escapeHtml(milestone.title)}</a> — ${escapeHtml(reasons.join(' / '))}</li>`;
    })
    .join('\n');
  return `  <h2>手当てが必要なマイルストーン</h2>
  <p class="lead">遅延・ブロック中・依存待ちのもの。期限を引き直すか、待ちを解消する行動を決める。</p>
  <ul>
${items}
  </ul>`;
}

// バーは stats.completion（done/total）を使う。大きな数字「N/M」と分母をそろえるため。
// 平均進捗（stats.progress）は分母が違う別の指標なので、同じバーに載せず文章で添える。
export function renderRoadmapPage(model: RoadmapModel, generatedAt: string): string {
  const body = `  <h1>ロードマップ</h1>
  <p class="lead">目標を実行の順番に落としたもの。トラックは並行して伸ばす軸、マイルストーンは 1〜3 ヶ月で終わる塊。</p>
  <p class="metric-label">更新: ${escapeHtml(model.updated)} ・ 基準日: ${escapeHtml(model.today)}</p>

  <div class="card-grid">
    <section class="card">
      <div class="metric"><span class="metric-value">${model.stats.done}/${model.stats.total}</span><span class="metric-label">完了したマイルストーン</span></div>
      ${bar(model.stats.completion)}
      <p class="metric-label">バー = 完了率 ${percent(model.stats.completion)}%（${model.stats.done}/${model.stats.total}）・ステップを含めた平均進捗 ${percent(model.stats.progress)}%</p>
    </section>
    <section class="card">
      <div class="metric"><span class="metric-value">${model.stats.inProgress}</span><span class="metric-label">進行中（予定 ${model.stats.planned}）</span></div>
    </section>
    <section class="card">
      <div class="metric"><span class="metric-value">${model.stats.overdue + model.stats.blocked}</span><span class="metric-label">遅延 ${model.stats.overdue} ・ ブロック ${model.stats.blocked}</span></div>
    </section>
  </div>

  <h2>全体像</h2>
${ganttChart(model)}

${attentionSection(model)}

${model.tracks.map(trackSection).join('\n\n')}`;

  return layout({ title: 'ロードマップ | Engineer Growth', active: 'roadmap', generatedAt, body });
}

export function renderRoadmapMarkdown(model: RoadmapModel): string {
  const lines: string[] = ['## ロードマップ', ''];
  lines.push(
    `マイルストーン ${model.stats.total} 件（完了 ${model.stats.done} / 進行中 ${model.stats.inProgress} / 遅延 ${model.stats.overdue} / ブロック ${model.stats.blocked}）。更新: ${model.updated}`,
    '',
  );

  for (const track of model.tracks) {
    lines.push(`### ${track.name}`, '');
    if (track.milestones.length === 0) {
      lines.push('まだマイルストーンがありません。', '');
      continue;
    }
    for (const milestone of track.milestones) {
      const flags = [STATUS_STYLE[milestone.status].label];
      if (milestone.overdue) flags.push('遅延');
      lines.push(
        `- **${milestone.title}**（${flags.join(' / ')}）${milestone.start} 〜 ${milestone.due} ・ ステップ ${milestone.stepsDone}/${milestone.stepsTotal}`,
      );
      lines.push(`  - 達成状態: ${oneLine(milestone.outcome)}`);
      lines.push(`  - 関連スキル: ${milestone.skills.map((id) => `\`${id}\``).join(', ')}`);
      if (milestone.goals && milestone.goals.length > 0) {
        lines.push(`  - 関連目標: ${milestone.goals.map((id) => `\`${id}\``).join(', ')}`);
      }
      if (milestone.blocked_reason) lines.push(`  - ブロック理由: ${oneLine(milestone.blocked_reason)}`);
      if (milestone.blockers.length > 0) {
        lines.push(`  - 未完了の依存: ${milestone.blockers.map((id) => `\`${id}\``).join(', ')}`);
      }
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

// バーは stats.completion（done/total）を使う。大きな数字「N/M」と分母をそろえるため。
// 平均進捗（stats.progress）は分母が違う別の指標なので、同じバーに載せず文章で添える。
export function renderRoadmapCard(model: RoadmapModel): string {
  // 「次に効くもの」を上に出す: 進行中 → ブロック中 → 予定の順。
  const priority: Record<MilestoneStatus, number> = { in_progress: 0, blocked: 1, planned: 2, done: 3 };
  const upcoming = [...model.milestones]
    .sort((a, b) => priority[a.status] - priority[b.status] || a.due.localeCompare(b.due))
    .slice(0, 3)
    .map(
      (milestone) =>
        `      <li>${escapeHtml(milestone.title)} — ${escapeHtml(milestone.due)} まで${milestone.overdue ? ' <span class="badge badge--risk">遅延</span>' : ''}</li>`,
    )
    .join('\n');

  const list = upcoming
    ? `    <ul>
${upcoming}
    </ul>`
    : '    <p class="empty">マイルストーンがありません。</p>';

  return `    <section class="card">
      <h2>ロードマップ</h2>
      <div class="metric"><span class="metric-value">${model.stats.done}/${model.stats.total}</span><span class="metric-label">完了したマイルストーン</span></div>
      ${bar(model.stats.completion)}
      <p class="metric-label">バー = 完了率 ${percent(model.stats.completion)}%（${model.stats.done}/${model.stats.total}）・ステップを含めた平均進捗 ${percent(model.stats.progress)}%</p>
${list}
      <p><a href="roadmap.html">ロードマップの詳細を見る</a></p>
    </section>`;
}
