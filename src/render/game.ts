/**
 * 成長ページ（dist/game.html）のレンダラ。
 *
 * このページの主役は「現在の数字」ではなく「前回からどれだけ伸びたか」である。
 * そのため差分（model.deltas）をヒーローの直下に置き、XP の内訳や実績はその後に回す。
 *
 * 比較できる記録がないときに 0 を並べない（嘘の 0 を見せない）のも同じ理由で、
 * 伸びていないことと測れていないことを混同させると、この仕組みは自己満足の道具になる。
 */

import type {
  AchievementDefinition,
  AchievementStatus,
  GameModel,
  GrowthDelta,
  Quest,
  Snapshot,
  XpBreakdown,
} from '../lib/game-types.ts';
import { escapeHtml, layout } from './layout.ts';

/** 折れ線は 2 点以上でないと「推移」にならない。1 点のグラフはグラフとして嘘になる。 */
const SPARK_MIN_POINTS = 2;
/** PROFILE.md に載せるクエストの件数。全部出すと「次の一手」が埋もれる。 */
const QUEST_MARKDOWN_LIMIT = 3;

/** 座標・幅などの数値を短く安定した文字列にする（出力差分を減らす）。 */
function num(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

/**
 * style 属性に埋める百分率。0-100 に丸めることで、
 * ratio が範囲外・NaN でもバーがコンテナを突き抜けない。
 */
function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

/** 3 桁区切り。toLocaleString は環境の ICU に依存し出力が揺れるため使わない。 */
function withThousands(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const rounded = Math.trunc(value);
  const sign = rounded < 0 ? '-' : '';
  return sign + String(Math.abs(rounded)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** 差分は符号付きで見せる。0 は ±0 として「測れたが動かなかった」ことを示す。 */
function signedInt(value: number): string {
  if (!Number.isFinite(value)) return '±0';
  const body = withThousands(Math.abs(value));
  if (Math.trunc(value) > 0) return `+${body}`;
  if (Math.trunc(value) < 0) return `-${body}`;
  return `±${body}`;
}

function signedFixed(value: number, digits: number): string {
  if (!Number.isFinite(value)) return '±0';
  const body = Math.abs(value).toFixed(digits);
  if (value > 0) return `+${body}`;
  if (value < 0) return `-${body}`;
  return `±${body}`;
}

function percentOf(value: number, total: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) return 0;
  return clampPercent((value / total) * 100);
}

/** 増減の向きを色に写すだけ。何が良い変化かの判断は lib 側の責務。 */
function deltaTone(value: number): string {
  if (value > 0) return ' delta--up';
  if (value < 0) return ' delta--down';
  return ' delta--flat';
}

/**
 * 到達度バー。数値はバーの見た目だけでは読めないため aria-label を必ず付ける。
 * style 属性に入るのは clampPercent を通した数値のみ。
 */
function bar(percent: number, label: string): string {
  return `<div class="bar" role="img" aria-label="${escapeHtml(label)}"><span class="bar-fill" style="width: ${num(
    clampPercent(percent),
  )}%"></span></div>`;
}

/* ------------------------------------------------------------------ *
 * 1. レベルのヒーロー
 * ------------------------------------------------------------------ */

function streakItem(count: number, label: string, unit: string, emoji: string): string {
  const idle = !Number.isFinite(count) || count <= 0;
  const safeCount = Number.isFinite(count) ? Math.trunc(count) : 0;
  // 絵文字は装飾なので aria-hidden にし、意味は必ずテキスト側に持たせる。
  const icon = idle ? '' : `<span aria-hidden="true">${emoji}</span>`;
  return `    <li class="streak${idle ? ' streak--idle' : ''}">${icon}<span>${escapeHtml(
    label,
  )}</span><span class="streak__count">${safeCount}</span><span>${escapeHtml(unit)}</span></li>`;
}

function atRiskLine(atRisk: ReadonlyArray<string>): string {
  if (atRisk.length === 0) return '';
  const items = atRisk
    .map((warning) => `<span class="badge badge--risk">途切れそう</span> ${escapeHtml(warning)}`)
    .join(' / ');
  return `\n  <p class="hero__xp">${items}</p>`;
}

/**
 * レベル・XP バー・ストリークのヒーロー。
 * 成長ページとダッシュボードの両方で使い回すため、独立した断片として返す。
 */
export function renderGameHero(model: GameModel): string {
  const { level, streaks } = model;
  const percent = clampPercent(level.ratio * 100);
  const progressLabel = `レベル ${level.level} の進捗 ${Math.round(percent)}%（次のレベルまであと ${withThousands(
    level.xpToNext,
  )} XP）`;

  const streakRow = [
    streakItem(streaks.blogWeeks, '連続投稿', '週', '🔥'),
    streakItem(streaks.blogMonths, '連続投稿', 'ヶ月', '📅'),
    streakItem(streaks.inventoryQuarters, '連続棚卸し', '四半期', '🧭'),
  ].join('\n');

  return `<section class="hero">
  <div class="hero__top">
    <div class="level-badge"><span class="level-badge__num">${escapeHtml(
      String(level.level),
    )}</span><span class="level-badge__label">LEVEL</span></div>
    <div class="hero__headline">
      <p class="level-title">${escapeHtml(level.title)}</p>
      <p class="hero__xp">累計 ${escapeHtml(withThousands(level.totalXp))} XP</p>
    </div>
  </div>
  <div class="xp-bar" role="img" aria-label="${escapeHtml(progressLabel)}"><span class="xp-bar__fill" style="width: ${num(
    percent,
  )}%"></span></div>
  <div class="xp-meta">
    <span>次のレベルまであと ${escapeHtml(withThousands(level.xpToNext))} XP</span>
    <span>Lv.${escapeHtml(String(level.level))} → Lv.${escapeHtml(String(level.level + 1))}</span>
  </div>
  <ul class="streak-row">
${streakRow}
  </ul>${atRiskLine(streaks.atRisk)}
</section>`;
}

/* ------------------------------------------------------------------ *
 * 2. 成長の差分
 * ------------------------------------------------------------------ */

function deltaCard(label: string, value: string, change: number): string {
  return `      <div class="delta${deltaTone(change)}">
        <p class="delta__label">${escapeHtml(label)}</p>
        <p class="delta__value">${escapeHtml(value)}</p>
      </div>`;
}

function achievementNames(achievements: ReadonlyArray<AchievementStatus>): ReadonlyMap<string, string> {
  return new Map(
    achievements.map((status) => [
      status.definition.id,
      `${status.definition.icon} ${status.definition.name}`,
    ]),
  );
}

function newAchievementLine(
  delta: GrowthDelta,
  achievements: ReadonlyArray<AchievementStatus>,
): string {
  if (delta.newAchievements.length === 0) return '';
  const names = achievementNames(achievements);
  const text = delta.newAchievements.map((id) => names.get(id) ?? id).join(' / ');
  return `\n  <p class="post-meta">この期間に解放した実績: ${escapeHtml(text)}</p>`;
}

function deltaGroup(delta: GrowthDelta, achievements: ReadonlyArray<AchievementStatus>): string {
  const heading = `  <h3>${escapeHtml(delta.label)}</h3>`;

  // 比較元がない期間に 0 を並べると「伸びていない」と読み違えるため、差分を出さずに理由を書く。
  if (delta.fromDate === null) {
    return `${heading}
  <p class="empty">比較できる記録がまだありません。記録が 2 件以上たまると、この期間の差分が出ます。</p>`;
  }

  const cards = [
    deltaCard('XP', `${signedInt(delta.xp)} XP`, delta.xp),
    deltaCard('レベル', signedInt(delta.level), delta.level),
    deltaCard('平均レベル', signedFixed(delta.skillAverage, 1), delta.skillAverage),
    deltaCard('記事数', `${signedInt(delta.posts)} 本`, delta.posts),
    deltaCard('マイルストーン完了', `${signedInt(delta.milestonesDone)} 件`, delta.milestonesDone),
    deltaCard('目標達成', `${signedInt(delta.goalsDone)} 件`, delta.goalsDone),
  ].join('\n');

  return `${heading}
  <p class="post-meta">${escapeHtml(delta.fromDate)} からの ${escapeHtml(
    String(Math.trunc(delta.days)),
  )} 日間</p>
  <div class="delta-grid">
${cards}
  </div>${newAchievementLine(delta, achievements)}`;
}

function deltaSection(model: GameModel): string {
  if (model.deltas.length === 0) {
    return '  <p class="empty"><code>pnpm growth snapshot</code> で記録を積むと、ここに伸びが出ます。</p>';
  }
  return model.deltas.map((delta) => deltaGroup(delta, model.achievements)).join('\n\n');
}

/* ------------------------------------------------------------------ *
 * 3. XP の推移グラフ（手書き inline SVG）
 * ------------------------------------------------------------------ */

/** ISO 日付を通算日数に変換する。記録の間隔が不均等でも横軸を実時間に合わせるため。 */
function dayNumber(date: string): number {
  const parsed = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(parsed) ? parsed / 86_400_000 : Number.NaN;
}

interface SparkPoint {
  x: number;
  y: number;
  snapshot: Snapshot;
  levelUp: boolean;
}

/**
 * 累計 XP のスパークライン。レベルアップした記録に印を付けることで、
 * 「どの記録で段が変わったか」を折れ線の上で読めるようにする。
 * 軸ラベルを最初と最後の日付・最小と最大の XP だけに絞るのは、密にすると読めないため。
 */
function sparkline(history: ReadonlyArray<Snapshot>): string {
  if (history.length < SPARK_MIN_POINTS) {
    return `  <p class="empty">XP の推移グラフは記録が ${SPARK_MIN_POINTS} 件以上たまってから描きます（現在 ${history.length} 件）。<code>pnpm growth snapshot</code> で記録を積んでください。</p>`;
  }

  const width = 720;
  const height = 220;
  const padLeft = 70;
  const padRight = 16;
  const padTop = 18;
  const padBottom = 30;
  const plotWidth = width - padLeft - padRight;
  const plotHeight = height - padTop - padBottom;
  const lastIndex = history.length - 1;

  const days = history.map((snapshot) => dayNumber(snapshot.date));
  const usableDays = days.every(Number.isFinite);
  const minDay = usableDays ? Math.min(...days) : 0;
  const maxDay = usableDays ? Math.max(...days) : 0;
  const daySpan = maxDay - minDay;

  const values = history.map((snapshot) => snapshot.xp.total);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const valueSpan = maxValue - minValue;

  const toY = (value: number): number =>
    valueSpan > 0
      ? padTop + plotHeight - ((value - minValue) / valueSpan) * plotHeight
      : padTop + plotHeight / 2;

  const points: SparkPoint[] = history.map((snapshot, index) => {
    // 日付が同じ・解析できない場合は等間隔に落とす（点が重なって線が消えるのを避ける）。
    const ratio = usableDays && daySpan > 0 ? ((days[index] ?? minDay) - minDay) / daySpan : index / lastIndex;
    const previous = index > 0 ? history[index - 1] : undefined;
    return {
      x: padLeft + ratio * plotWidth,
      y: toY(snapshot.xp.total),
      snapshot,
      levelUp: previous !== undefined && snapshot.level > previous.level,
    };
  });

  const polyline = points.map((point) => `${num(point.x)},${num(point.y)}`).join(' ');

  const baseline = [toY(maxValue), toY(minValue)]
    .map(
      (y) =>
        `    <line x1="${num(padLeft)}" y1="${num(y)}" x2="${num(
          width - padRight,
        )}" y2="${num(y)}" stroke="currentColor" stroke-opacity="0.18" stroke-width="1"></line>`,
    )
    .join('\n');

  const markers = points
    .filter((point) => point.levelUp)
    .map(
      (point) =>
        `    <circle cx="${num(point.x)}" cy="${num(
          point.y,
        )}" r="4" style="fill: var(--xp)" stroke="currentColor" stroke-opacity="0.35" stroke-width="1"></circle>`,
    )
    .join('\n');

  const lastPoint = points[lastIndex];
  const head =
    lastPoint === undefined
      ? ''
      : `\n    <circle cx="${num(lastPoint.x)}" cy="${num(
          lastPoint.y,
        )}" r="3" style="fill: var(--accent)"></circle>`;

  const firstDate = history[0]?.date ?? '';
  const lastDate = history[lastIndex]?.date ?? '';
  const valueLabels =
    valueSpan > 0
      ? `    <text x="${num(padLeft - 10)}" y="${num(
          toY(maxValue),
        )}" text-anchor="end" dominant-baseline="middle" font-size="12" fill="currentColor" fill-opacity="0.75">${escapeHtml(
          withThousands(maxValue),
        )} XP</text>
    <text x="${num(padLeft - 10)}" y="${num(
      toY(minValue),
    )}" text-anchor="end" dominant-baseline="middle" font-size="12" fill="currentColor" fill-opacity="0.75">${escapeHtml(
      withThousands(minValue),
    )} XP</text>`
      : `    <text x="${num(padLeft - 10)}" y="${num(
          toY(minValue),
        )}" text-anchor="end" dominant-baseline="middle" font-size="12" fill="currentColor" fill-opacity="0.75">${escapeHtml(
          withThousands(minValue),
        )} XP</text>`;

  const levelUps = points.filter((point) => point.levelUp).length;
  const caption =
    levelUps === 0
      ? `記録 ${history.length} 件の累計 XP。この期間のレベルアップはまだありません。`
      : `記録 ${history.length} 件の累計 XP。丸い印（${levelUps} 個）はレベルが上がった記録。`;

  return `  <svg class="spark" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-labelledby="spark-title">
    <title id="spark-title">累計 XP の推移（${escapeHtml(firstDate)} から ${escapeHtml(
      lastDate,
    )}、${escapeHtml(withThousands(minValue))} XP から ${escapeHtml(
      withThousands(maxValue),
    )} XP）</title>
${baseline}
    <polyline points="${polyline}" fill="none" style="stroke: var(--xp)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"></polyline>
${markers}${head}
${valueLabels}
    <text x="${num(padLeft)}" y="${num(
      height - 10,
    )}" text-anchor="start" font-size="12" fill="currentColor" fill-opacity="0.75">${escapeHtml(
      firstDate,
    )}</text>
    <text x="${num(width - padRight)}" y="${num(
      height - 10,
    )}" text-anchor="end" font-size="12" fill="currentColor" fill-opacity="0.75">${escapeHtml(
      lastDate,
    )}</text>
  </svg>
  <p class="chart-caption">${escapeHtml(caption)}</p>`;
}

/* ------------------------------------------------------------------ *
 * 4. 今日のクエスト
 * ------------------------------------------------------------------ */

const URGENCY: Record<Quest['urgency'], { modifier: string; label: string; badge: string }> = {
  now: { modifier: ' quest--now', label: '今すぐ', badge: ' badge--risk' },
  soon: { modifier: '', label: '近いうちに', badge: ' badge--active' },
  later: { modifier: ' quest--later', label: 'いつか', badge: '' },
};

const KIND_LABEL: Record<Quest['kind'], string> = {
  skill: 'スキル',
  goal: '目標',
  roadmap: 'ロードマップ',
  blog: 'ブログ',
  hygiene: 'データ品質',
};

function questItem(quest: Quest): string {
  // 緊急度は枠線の色だけでなくバッジのテキストでも示す（色だけでは読めない）。
  const urgency = URGENCY[quest.urgency] ?? URGENCY.soon;
  const kind = KIND_LABEL[quest.kind] ?? quest.kind;
  return `    <li class="quest${urgency.modifier}">
      <div class="quest__body">
        <p class="quest__title"><span class="badge${urgency.badge}">${escapeHtml(
          urgency.label,
        )}</span> <span class="badge">${escapeHtml(kind)}</span> ${escapeHtml(quest.title)}</p>
        <p class="quest__why">${escapeHtml(quest.why)}</p>
        <p class="quest__target">編集するファイル: ${escapeHtml(quest.target)}</p>
      </div>
      <span class="quest__xp">+${escapeHtml(withThousands(quest.xp))} XP</span>
    </li>`;
}

function questSection(quests: ReadonlyArray<Quest>): string {
  if (quests.length === 0) {
    return '  <p class="empty">手当てが必要なことはありません。</p>';
  }
  return `  <ul class="quest-list">
${quests.map(questItem).join('\n')}
  </ul>`;
}

/* ------------------------------------------------------------------ *
 * 5. XP の内訳
 * ------------------------------------------------------------------ */

const XP_ROWS: ReadonlyArray<{ key: Exclude<keyof XpBreakdown, 'total'>; label: string }> = [
  { key: 'skills', label: 'スキル' },
  { key: 'goals', label: '目標' },
  { key: 'roadmap', label: 'ロードマップ' },
  { key: 'blog', label: 'ブログ' },
  { key: 'achievements', label: '実績' },
];

function xpTable(xp: XpBreakdown): string {
  const rows = XP_ROWS.map(({ key, label }) => {
    const value = xp[key];
    const percent = percentOf(value, xp.total);
    return `        <tr>
          <td>${escapeHtml(label)}</td>
          <td>${escapeHtml(withThousands(value))}</td>
          <td>${escapeHtml(percent.toFixed(1))}%</td>
          <td>${bar(percent, `${label} ${withThousands(value)} XP（全体の ${percent.toFixed(1)}%）`)}</td>
        </tr>`;
  }).join('\n');

  return `  <div class="table-scroll">
    <table class="table">
      <thead><tr><th>領域</th><th>XP</th><th>割合</th><th></th></tr></thead>
      <tbody>
${rows}
        <tr><td>合計</td><td>${escapeHtml(withThousands(xp.total))}</td><td>100.0%</td><td></td></tr>
      </tbody>
    </table>
  </div>`;
}

/* ------------------------------------------------------------------ *
 * 6. 実績
 * ------------------------------------------------------------------ */

const TIER_ORDER: Record<AchievementDefinition['tier'], number> = {
  bronze: 0,
  silver: 1,
  gold: 2,
  platinum: 3,
};

/** 難易度の帯の順に並べる（型定義が tier を表示順と定めている）。同じ帯なら lib の順を保つ。 */
function sortByTier(
  achievements: ReadonlyArray<AchievementStatus>,
): ReadonlyArray<AchievementStatus> {
  return [...achievements]
    .map((status, index) => ({ status, index }))
    .sort((a, b) => {
      const tierDiff =
        (TIER_ORDER[a.status.definition.tier] ?? 0) - (TIER_ORDER[b.status.definition.tier] ?? 0);
      return tierDiff !== 0 ? tierDiff : a.index - b.index;
    })
    .map((entry) => entry.status);
}

function achievementItem(status: AchievementStatus): string {
  const { definition, unlocked, progress, detail } = status;
  const percent = clampPercent(progress * 100);
  // 未解放でも隠さない。見えていない目標は目標にならない。
  const stateText = unlocked ? '解放済み' : '未解放';
  const progressBar =
    unlocked || percent <= 0 || percent >= 100
      ? ''
      : `\n        ${bar(percent, `${definition.name} の進捗 ${Math.round(percent)}%`)}`;

  return `    <li class="achievement${unlocked ? '' : ' is-locked'}" data-tier="${escapeHtml(
    definition.tier,
  )}">
      <span class="achievement__icon" aria-hidden="true">${escapeHtml(definition.icon)}</span>
      <div>
        <p class="achievement__name">${escapeHtml(definition.name)}</p>
        <p class="achievement__desc">${escapeHtml(definition.description)}</p>
        <p class="achievement__detail">${escapeHtml(stateText)} ・ ${escapeHtml(
          detail,
        )} ・ +${escapeHtml(withThousands(definition.xp))} XP</p>${progressBar}
      </div>
    </li>`;
}

function achievementSection(achievements: ReadonlyArray<AchievementStatus>): string {
  if (achievements.length === 0) {
    return '  <p class="empty">実績の定義がありません。</p>';
  }
  return `  <ul class="achievement-grid">
${sortByTier(achievements).map(achievementItem).join('\n')}
  </ul>`;
}

function unlockedCount(achievements: ReadonlyArray<AchievementStatus>): number {
  return achievements.filter((status) => status.unlocked).length;
}

/* ------------------------------------------------------------------ *
 * 公開 API
 * ------------------------------------------------------------------ */

/** 成長ページ（dist/game.html）の完全な HTML。 */
export function renderGamePage(model: GameModel, generatedAt: string): string {
  const unlocked = unlockedCount(model.achievements);

  const body = `  <h1>成長</h1>
  <p class="lead">今の数字より、前回の記録からどれだけ伸びたかを見るページ。基準日 ${escapeHtml(
    model.today,
  )}。</p>

${renderGameHero(model)}

  <h2>成長の差分</h2>
  <p class="lead">XP は <code>data/</code> と <code>blog/</code> から機械的に導出した値で、手で書く場所はありません。</p>
${deltaSection(model)}

  <h2>XP の推移</h2>
${sparkline(model.history)}

  <h2>今日のクエスト</h2>
  <p class="lead">やると XP が増える順ではなく、今やる理由がある順に並んでいます。</p>
${questSection(model.quests)}

  <h2>XP の内訳</h2>
${xpTable(model.xp)}

  <h2>実績 <span class="badge badge--active">${unlocked} / ${model.achievements.length} 解放</span></h2>
${achievementSection(model.achievements)}`;

  return layout({ title: '成長 | Engineer Growth', active: 'game', generatedAt, body });
}

/** ダッシュボード用のサマリカード。 */
export function renderGameCard(model: GameModel): string {
  const { level } = model;
  const unlocked = unlockedCount(model.achievements);
  const latest = model.deltas.find((delta) => delta.fromDate !== null);
  const deltaLine =
    latest === undefined
      ? '<p class="post-meta">比較できる記録がまだありません。<code>pnpm growth snapshot</code> で記録を積むと伸びが出ます。</p>'
      : `<p class="post-meta">${escapeHtml(latest.label)}: <span class="badge badge--active">${escapeHtml(
          `${signedInt(latest.xp)} XP`,
        )}</span> レベル ${escapeHtml(signedInt(latest.level))} ・ 平均レベル ${escapeHtml(
          signedFixed(latest.skillAverage, 1),
        )}</p>`;

  return `    <section class="card">
      <h2><a href="game.html">成長</a> <span class="badge">Lv.${escapeHtml(
        String(level.level),
      )} ${escapeHtml(level.title)}</span></h2>
      <div class="metric"><span class="metric-value">${escapeHtml(
        withThousands(level.totalXp),
      )}</span><span class="metric-label">累計 XP / 次のレベルまであと ${escapeHtml(
        withThousands(level.xpToNext),
      )} XP</span></div>
      ${deltaLine}
      <p class="post-meta">実績 ${unlocked} / ${model.achievements.length} 解放</p>
    </section>`;
}

/** Markdown のテーブルセルを壊さないようにする（| と改行を無害化）。 */
function mdCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

/** PROFILE.md 用の成長節。データが同じなら必ず同じ出力になる（時刻を混ぜない）。 */
export function renderGameMarkdown(model: GameModel): string {
  const { level, streaks } = model;
  const unlocked = model.achievements.filter((status) => status.unlocked);

  const lines: string[] = ['## 成長', ''];
  lines.push(
    `- レベル: ${level.level}（${mdCell(level.title)}）`,
    `- 累計 XP: ${withThousands(level.totalXp)}`,
    `- 次のレベルまで: ${withThousands(level.xpToNext)} XP（Lv.${level.level} → Lv.${level.level + 1}）`,
    `- 継続: 連続投稿 ${streaks.blogWeeks} 週 / ${streaks.blogMonths} ヶ月 ・ 連続棚卸し ${streaks.inventoryQuarters} 四半期`,
    `- 実績: ${unlocked.length} / ${model.achievements.length} 解放`,
    '',
    '### 成長の差分',
    '',
  );

  const comparable = model.deltas.filter((delta) => delta.fromDate !== null);
  if (comparable.length === 0) {
    lines.push('比較できる記録がまだありません。`pnpm growth snapshot` で記録を積むと差分が出ます。');
  } else {
    lines.push(
      '| 期間 | 比較元 | XP | レベル | 平均レベル | 記事 | マイルストーン | 目標達成 |',
      '|---|---|---|---|---|---|---|---|',
    );
    for (const delta of comparable) {
      lines.push(
        `| ${mdCell(delta.label)} | ${mdCell(delta.fromDate ?? '-')}（${Math.trunc(
          delta.days,
        )} 日） | ${signedInt(delta.xp)} | ${signedInt(delta.level)} | ${signedFixed(
          delta.skillAverage,
          1,
        )} | ${signedInt(delta.posts)} | ${signedInt(delta.milestonesDone)} | ${signedInt(
          delta.goalsDone,
        )} |`,
      );
    }
  }

  lines.push('', '### 解放済みの実績', '');
  if (unlocked.length === 0) {
    lines.push('まだありません。');
  } else {
    lines.push(
      sortByTier(unlocked)
        .map((status) => `${mdCell(status.definition.icon)} ${mdCell(status.definition.name)}`)
        .join(' / '),
    );
  }

  lines.push('', '### 今日のクエスト', '');
  if (model.quests.length === 0) {
    lines.push('手当てが必要なことはありません。');
  } else {
    for (const quest of model.quests.slice(0, QUEST_MARKDOWN_LIMIT)) {
      lines.push(
        `1. **${mdCell(quest.title)}**（+${withThousands(quest.xp)} XP / ${mdCell(quest.target)}）`,
        `   - ${mdCell(quest.why)}`,
      );
    }
  }

  return lines.join('\n');
}
