import { formatWeight, type CategoryAggregate, type SkillGap, type SkillsModel } from '../lib/skills.ts';
import type { Skill } from '../schema/skills.ts';
import { escapeHtml, layout } from './layout.ts';

/** 表示するギャップの最大件数。全部並べると「次の一手」が埋もれるため絞る。 */
const GAP_DISPLAY_LIMIT = 10;
/** レーダーチャートはポリゴンを描く必要があるため軸 3 本以上で成立する。 */
const RADAR_MIN_AXES = 3;
const MAX_LEVEL = 5;

/** 座標・幅などの数値を短く安定した文字列にする（出力差分を減らす）。 */
function num(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function levelChip(level: number): string {
  return `<span class="level-chip" data-level="${level}">${level}</span>`;
}

/**
 * 目標に対する到達度バー。target 未設定なら最大レベルに対する比率を見せる。
 * aria-label を付けるのは、バーだけでは数値が読み取れないため。
 */
function progressBar(level: number, target: number | undefined): string {
  const goal = target ?? MAX_LEVEL;
  const ratio = goal === 0 ? 1 : Math.min(1, level / goal);
  const label = target === undefined ? `レベル ${level} / 最大 ${MAX_LEVEL}` : `レベル ${level} / 目標 ${target}`;
  return `<div class="bar" role="img" aria-label="${escapeHtml(label)}"><span class="bar-fill" style="width: ${num(
    ratio * 100,
  )}%"></span></div>`;
}

/**
 * 外部リンク。rel="noreferrer noopener" は参照元の漏洩と
 * window.opener 経由の tabnabbing を防ぐため（blog 領域の実装と揃えている）。
 */
function skillLinks(skill: Skill): string {
  if (!skill.links || skill.links.length === 0) return '';
  return skill.links
    .map(
      (item) =>
        `<a href="${escapeHtml(item.url)}" rel="noreferrer noopener">${escapeHtml(item.label)}</a>`,
    )
    .join(' / ');
}

function evidenceCell(skill: Skill): string {
  const parts: string[] = [];
  if (skill.evidence && skill.evidence.length > 0) {
    parts.push(
      `<ul>${skill.evidence.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`,
    );
  }
  const links = skillLinks(skill);
  if (links) parts.push(`<p class="post-meta">${links}</p>`);
  if (skill.notes) parts.push(`<p class="post-meta">${escapeHtml(skill.notes)}</p>`);
  if (parts.length === 0) return '<span class="badge badge--warn">根拠なし</span>';
  return parts.join('');
}

interface RadarPoint {
  x: number;
  y: number;
}

/** 極座標 → SVG 座標。真上（-90°）を起点に時計回りへ軸を配置する。 */
function polar(cx: number, cy: number, radius: number, index: number, count: number): RadarPoint {
  const angle = (Math.PI * 2 * index) / count - Math.PI / 2;
  return { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
}

function polygonPoints(points: ReadonlyArray<RadarPoint>): string {
  return points.map((point) => `${num(point.x)},${num(point.y)}`).join(' ');
}

/**
 * カテゴリ別レーダーチャート（手書き inline SVG）。
 * 現在レベルと目標レベルの 2 ポリゴンを重ねることで「どの方向にどれだけ足りないか」を一目で示す。
 * 色は style 属性経由で CSS 変数を参照し、ダークモードに追従させる。
 */
function renderSkillsRadarChart(categories: ReadonlyArray<CategoryAggregate>): string {
  const axes = categories.filter((category) => category.skills.length > 0);
  if (axes.length < RADAR_MIN_AXES) {
    return `<p class="empty">レーダーチャートの描画には ${RADAR_MIN_AXES} カテゴリ以上のデータが必要です。</p>`;
  }

  // 軸ラベル（カテゴリ名）が左右に伸びるため、半径より十分広い viewBox を取る。
  const width = 680;
  const height = 430;
  const cx = width / 2;
  const cy = 215;
  const radius = 140;
  const count = axes.length;
  const scale = (level: number) => (radius * level) / MAX_LEVEL;

  const grid = Array.from({ length: MAX_LEVEL }, (_, step) => {
    const ring = polygonPoints(
      axes.map((_, index) => polar(cx, cy, scale(step + 1), index, count)),
    );
    return `    <polygon points="${ring}" fill="none" stroke="currentColor" stroke-opacity="0.18" stroke-width="1"></polygon>`;
  }).join('\n');

  const spokes = axes
    .map((_, index) => {
      const end = polar(cx, cy, radius, index, count);
      return `    <line x1="${num(cx)}" y1="${num(cy)}" x2="${num(end.x)}" y2="${num(
        end.y,
      )}" stroke="currentColor" stroke-opacity="0.18" stroke-width="1"></line>`;
    })
    .join('\n');

  const currentPolygon = polygonPoints(
    axes.map((category, index) => polar(cx, cy, scale(category.averageLevel), index, count)),
  );
  const targetPolygon = polygonPoints(
    axes.map((category, index) => polar(cx, cy, scale(category.targetAverageLevel), index, count)),
  );

  const labels = axes
    .map((category, index) => {
      const point = polar(cx, cy, radius + 26, index, count);
      // ラベルが円の左右どちらにあるかで text-anchor を変え、図形への被りを避ける。
      const dx = point.x - cx;
      const anchor = Math.abs(dx) < 12 ? 'middle' : dx > 0 ? 'start' : 'end';
      const text = `${category.name} ${category.averageLevel.toFixed(1)}`;
      return `    <text x="${num(point.x)}" y="${num(
        point.y,
      )}" text-anchor="${anchor}" dominant-baseline="middle" font-size="12" fill="currentColor" fill-opacity="0.75">${escapeHtml(
        text,
      )}</text>`;
    })
    .join('\n');

  const legendY = height - 18;
  const legend = `    <rect x="${num(cx - 150)}" y="${num(
    legendY - 9,
  )}" width="14" height="10" rx="2" style="fill: var(--accent); fill-opacity: 0.35; stroke: var(--accent)"></rect>
    <text x="${num(cx - 130)}" y="${num(
      legendY,
    )}" font-size="12" fill="currentColor" dominant-baseline="middle">現在レベル</text>
    <rect x="${num(cx + 10)}" y="${num(
      legendY - 9,
    )}" width="14" height="10" rx="2" fill="none" style="stroke: var(--warning)" stroke-dasharray="4 3"></rect>
    <text x="${num(cx + 30)}" y="${num(
      legendY,
    )}" font-size="12" fill="currentColor" dominant-baseline="middle">目標レベル</text>`;

  return `<svg class="chart" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-labelledby="radar-title">
    <title id="radar-title">カテゴリ別スキルレーダーチャート（現在レベルと目標レベル）</title>
${grid}
${spokes}
    <polygon points="${targetPolygon}" fill="none" style="stroke: var(--warning)" stroke-width="1.5" stroke-dasharray="5 4"></polygon>
    <polygon points="${currentPolygon}" style="fill: var(--accent); fill-opacity: 0.22; stroke: var(--accent)" stroke-width="2"></polygon>
${labels}
${legend}
  </svg>
  <p class="chart-caption">軸ラベルの数値は各カテゴリの現在レベル平均（0-${MAX_LEVEL}）。破線は目標レベル平均。</p>`;
}

function metricCard(value: string, label: string): string {
  return `    <section class="card">
      <div class="metric"><span class="metric-value">${escapeHtml(
        value,
      )}</span><span class="metric-label">${escapeHtml(label)}</span></div>
    </section>`;
}

function categoryTable(category: CategoryAggregate): string {
  const rows = category.skills
    .map(
      (skill) => `        <tr>
          <td>${escapeHtml(skill.name)}<br><span class="post-meta">${escapeHtml(skill.id)}</span></td>
          <td>${levelChip(skill.level)}</td>
          <td>${skill.target === undefined ? '<span class="badge">維持</span>' : levelChip(skill.target)}</td>
          <td>${progressBar(skill.level, skill.target)}</td>
          <td>${skill.experience_years === undefined ? '—' : `${escapeHtml(String(skill.experience_years))} 年`}</td>
          <td>${skill.last_used === undefined ? '—' : escapeHtml(skill.last_used)}</td>
          <td>${evidenceCell(skill)}</td>
        </tr>`,
    )
    .join('\n');

  return `  <h3>${escapeHtml(category.name)} <span class="badge">weight ${escapeHtml(
    formatWeight(category.weight),
  )}</span> <span class="badge badge--active">平均 ${escapeHtml(
    category.averageLevel.toFixed(2),
  )} / 目標 ${escapeHtml(category.targetAverageLevel.toFixed(2))}</span></h3>
  <div class="table-scroll">
    <table class="table">
      <thead>
        <tr><th>スキル</th><th>現在</th><th>目標</th><th>到達度</th><th>経験年数</th><th>最終利用</th><th>根拠・備考</th></tr>
      </thead>
      <tbody>
${rows}
      </tbody>
    </table>
  </div>`;
}

function gapTable(gaps: ReadonlyArray<SkillGap>, categoryNames: ReadonlyMap<string, string>): string {
  if (gaps.length === 0) {
    return '  <p class="empty">目標に届いていないスキルはありません。目標を引き上げる時期かもしれません。</p>';
  }
  const rows = gaps
    .slice(0, GAP_DISPLAY_LIMIT)
    .map(
      ({ skill, gap }) => `        <tr>
          <td>${escapeHtml(skill.name)}</td>
          <td>${escapeHtml(categoryNames.get(skill.category) ?? skill.category)}</td>
          <td>${levelChip(skill.level)} → ${levelChip(skill.target ?? skill.level)}</td>
          <td>+${gap}</td>
        </tr>`,
    )
    .join('\n');

  return `  <div class="table-scroll">
    <table class="table">
      <thead><tr><th>スキル</th><th>カテゴリ</th><th>現在 → 目標</th><th>ギャップ</th></tr></thead>
      <tbody>
${rows}
      </tbody>
    </table>
  </div>`;
}

function strengthList(strengths: ReadonlyArray<Skill>): string {
  if (strengths.length === 0) {
    return '  <p class="empty">レベル 4 以上のスキルはまだありません。ギャップ上位から着手しましょう。</p>';
  }
  const items = strengths
    .map(
      (skill) => `    <li class="post-item">
      <h3>${levelChip(skill.level)} ${escapeHtml(skill.name)}</h3>
      ${
        skill.evidence && skill.evidence.length > 0
          ? `<ul>${skill.evidence.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
          : '<p class="post-meta">根拠が未記入です。</p>'
      }
    </li>`,
    )
    .join('\n');
  return `  <ul class="post-list">
${items}
  </ul>`;
}

function levelsTable(model: SkillsModel): string {
  const rows = model.levels
    .map(
      (definition) => `        <tr>
          <td>${levelChip(definition.level)}</td>
          <td>${escapeHtml(definition.name)}</td>
          <td>${escapeHtml(definition.description)}</td>
        </tr>`,
    )
    .join('\n');
  return `  <div class="table-scroll">
    <table class="table">
      <thead><tr><th>レベル</th><th>呼称</th><th>定義</th></tr></thead>
      <tbody>
${rows}
      </tbody>
    </table>
  </div>`;
}

function warningSection(warnings: ReadonlyArray<string>): string {
  if (warnings.length === 0) return '';
  const items = warnings
    .map((warning) => `    <li><span class="badge badge--warn">要確認</span> ${escapeHtml(warning)}</li>`)
    .join('\n');
  return `  <h2>データ品質の注意</h2>
  <p class="lead">棚卸しの精度を保つための自己点検項目です（ビルドは失敗しません）。</p>
  <ul>
${items}
  </ul>`;
}

/** スキルページ（dist/skills.html）の完全な HTML。 */
export function renderSkillsPage(model: SkillsModel, generatedAt: string): string {
  const categoryNames = new Map(model.categories.map((category) => [category.id, category.name]));
  const populated = model.categories.filter((category) => category.skills.length > 0);

  const body = `  <h1>スキル</h1>
  <p class="lead">${escapeHtml(model.owner.name)}（${escapeHtml(model.owner.role)}）/ 棚卸し日 ${escapeHtml(
    model.owner.updated,
  )}</p>

  <div class="card-grid">
${metricCard(String(model.stats.skillCount), 'スキル数')}
${metricCard(model.stats.averageLevel.toFixed(2), '平均レベル')}
${metricCard(model.stats.weightedAverageLevel.toFixed(2), '重み付き平均')}
${metricCard(String(model.stats.strengthCount), 'レベル4以上')}
  </div>

  <h2>カテゴリ別バランス</h2>
${renderSkillsRadarChart(model.categories)}

  <h2>次に伸ばすスキル（ギャップ上位）</h2>
${gapTable(model.gaps, categoryNames)}

  <h2>強み（レベル4以上）</h2>
${strengthList(model.strengths)}

  <h2>カテゴリ別スキル一覧</h2>
${
    populated.length === 0
      ? '  <p class="empty">スキルが登録されていません。</p>'
      : populated.map(categoryTable).join('\n\n')
  }

  <h2>レベル定義</h2>
${levelsTable(model)}
${warningSection(model.warnings)}`;

  return layout({ title: 'スキル | Engineer Growth', active: 'skills', generatedAt, body });
}

/** Markdown のテーブルセルを壊さないようにする（| と改行を無害化）。 */
function mdCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

/** PROFILE.md 用のスキル節。 */
export function renderSkillsMarkdown(model: SkillsModel): string {
  const lines: string[] = ['## スキル', ''];
  lines.push(
    `- 棚卸し日: ${mdCell(model.owner.updated)}（${mdCell(model.owner.role)}）`,
    `- 登録スキル: ${model.stats.skillCount} 件 / 平均レベル ${model.stats.averageLevel.toFixed(2)}`,
    `- 重み付き平均レベル: ${model.stats.weightedAverageLevel.toFixed(2)}`,
    `- レベル4以上: ${model.stats.strengthCount} 件`,
    '',
    '### カテゴリ別平均',
    '',
    '| カテゴリ | 重み | スキル数 | 平均 | 目標平均 |',
    '|---|---|---|---|---|',
  );
  for (const category of model.categories) {
    lines.push(
      `| ${mdCell(category.name)} | ${formatWeight(category.weight)} | ${category.skills.length} | ${category.averageLevel.toFixed(
        2,
      )} | ${category.targetAverageLevel.toFixed(2)} |`,
    );
  }

  lines.push('', '### 強み（レベル4以上）', '');
  if (model.strengths.length === 0) {
    lines.push('まだありません。');
  } else {
    lines.push('| スキル | レベル | 根拠 |', '|---|---|---|');
    for (const skill of model.strengths) {
      lines.push(
        `| ${mdCell(skill.name)} | ${skill.level} | ${mdCell(skill.evidence?.[0] ?? '-')} |`,
      );
    }
  }

  lines.push('', '### 次に伸ばすスキル', '');
  if (model.gaps.length === 0) {
    lines.push('目標に届いていないスキルはありません。');
  } else {
    lines.push('| スキル | 現在 | 目標 | ギャップ |', '|---|---|---|---|');
    for (const { skill, gap } of model.gaps.slice(0, GAP_DISPLAY_LIMIT)) {
      lines.push(`| ${mdCell(skill.name)} | ${skill.level} | ${skill.target ?? skill.level} | +${gap} |`);
    }
  }

  return lines.join('\n');
}

/** ダッシュボード用のサマリカード。 */
export function renderSkillsCard(model: SkillsModel): string {
  const topGaps = model.gaps.slice(0, 3);
  const gapList =
    topGaps.length === 0
      ? '<p class="post-meta">目標に届いていないスキルはありません。</p>'
      : `<ul>${topGaps
          .map(
            ({ skill, gap }) =>
              `<li>${escapeHtml(skill.name)} ${levelChip(skill.level)} → ${levelChip(
                skill.target ?? skill.level,
              )} <span class="badge badge--active">+${gap}</span></li>`,
          )
          .join('')}</ul>`;

  const warnBadge =
    model.warnings.length > 0
      ? ` <span class="badge badge--warn">要確認 ${model.warnings.length}</span>`
      : '';

  return `    <section class="card">
      <h2><a href="skills.html">スキル</a>${warnBadge}</h2>
      <div class="metric"><span class="metric-value">${escapeHtml(
        model.stats.averageLevel.toFixed(2),
      )}</span><span class="metric-label">平均レベル / ${model.stats.skillCount} スキル</span></div>
      <p class="post-meta">重み付き平均 ${escapeHtml(
        model.stats.weightedAverageLevel.toFixed(2),
      )} ・ レベル4以上 ${model.stats.strengthCount} 件</p>
      ${gapList}
    </section>`;
}
