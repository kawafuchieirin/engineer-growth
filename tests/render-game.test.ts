import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type {
  AchievementStatus,
  GameModel,
  GrowthDelta,
  Quest,
  Snapshot,
} from '../src/lib/game-types.ts';
import {
  renderGameCard,
  renderGameHero,
  renderGameMarkdown,
  renderGamePage,
} from '../src/render/game.ts';

const GENERATED_AT = '2026-10-11 21:27 (JST)';

function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    date: '2026-07-01',
    xp: { skills: 400, goals: 120, roadmap: 90, blog: 100, achievements: 40, total: 750 },
    level: 4,
    skillAverage: 2.4,
    skillCount: 12,
    posts: 2,
    milestonesDone: 1,
    goalsDone: 0,
    achievements: ['first-post'],
    ...overrides,
  };
}

function delta(overrides: Partial<GrowthDelta> = {}): GrowthDelta {
  return {
    label: '前回の記録から',
    fromDate: '2026-09-01',
    days: 40,
    xp: 120,
    level: 1,
    skillAverage: 0.4,
    posts: 1,
    milestonesDone: 1,
    goalsDone: 0,
    newAchievements: ['first-post'],
    ...overrides,
  };
}

function quest(overrides: Partial<Quest> = {}): Quest {
  return {
    id: 'q-skill-terraform',
    title: 'Terraform のモジュール化を進める',
    why: '目標 g-2026q4-iac の KR が 40% で遅れている',
    xp: 20,
    target: 'data/skills.yaml',
    kind: 'skill',
    urgency: 'now',
    ...overrides,
  };
}

function achievement(overrides: Partial<AchievementStatus> = {}): AchievementStatus {
  return {
    definition: {
      id: 'first-post',
      name: '最初の一歩',
      description: '記事を 1 本公開する',
      icon: '✍️',
      xp: 20,
      tier: 'bronze',
    },
    unlocked: true,
    progress: 1,
    detail: '3 / 1 記事',
    ...overrides,
  };
}

function model(overrides: Partial<GameModel> = {}): GameModel {
  const current = snapshot({ date: '2026-10-11', xp: { skills: 520, goals: 160, roadmap: 105, blog: 150, achievements: 60, total: 995 }, level: 5 });
  return {
    xp: current.xp,
    level: {
      level: 5,
      title: '一人前',
      totalXp: 995,
      levelFloorXp: 894,
      nextLevelXp: 1176,
      xpToNext: 181,
      ratio: 0.358,
    },
    streaks: {
      blogWeeks: 3,
      blogMonths: 2,
      inventoryQuarters: 0,
      atRisk: ['今週はまだ記事がありません'],
    },
    achievements: [
      achievement(),
      achievement({
        definition: {
          id: 'ten-posts',
          name: '継続は力',
          description: '記事を 10 本公開する',
          icon: '📚',
          xp: 60,
          tier: 'silver',
        },
        unlocked: false,
        progress: 0.3,
        detail: '3 / 10 記事',
      }),
    ],
    quests: [quest(), quest({ id: 'q-blog', urgency: 'later', kind: 'blog', xp: 50 })],
    history: [snapshot(), snapshot({ date: '2026-09-01', level: 4 }), current],
    deltas: [delta(), delta({ label: '始めてから', fromDate: '2026-07-01', days: 102, xp: 245 })],
    current,
    today: '2026-10-11',
    ...overrides,
  };
}

/** HTML に現れるすべての class トークンを集める。 */
function classTokens(html: string): Set<string> {
  const tokens = new Set<string>();
  for (const match of html.matchAll(/class="([^"]*)"/g)) {
    for (const token of (match[1] ?? '').split(/\s+/)) {
      if (token.length > 0) tokens.add(token);
    }
  }
  return tokens;
}

/** style="width: NN%" の NN を数値として取り出す。 */
function widths(html: string, className: string): number[] {
  const pattern = new RegExp(`class="${className}"[^>]*style="width: ([^"]+)%"`, 'g');
  return [...html.matchAll(pattern)].map((match) => Number(match[1]));
}

describe('renderGamePage', () => {
  it('完全な HTML を返す', () => {
    const html = renderGamePage(model(), GENERATED_AT);
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html.trimEnd().endsWith('</html>')).toBe(true);
    expect(html).toContain('<title>成長 | Engineer Growth</title>');
    expect(html).toContain(GENERATED_AT);
  });

  it('game ナビゲーションを現在ページとして示す', () => {
    const html = renderGamePage(model(), GENERATED_AT);
    expect(html).toContain('href="game.html"');
    expect(html).toContain('aria-current="page"');
  });

  it('ヒーロー・差分・推移・クエスト・内訳・実績をこの順に並べる', () => {
    const html = renderGamePage(model(), GENERATED_AT);
    const order = [
      'class="hero"',
      '<h2>成長の差分</h2>',
      '<h2>XP の推移</h2>',
      '<h2>今日のクエスト</h2>',
      '<h2>XP の内訳</h2>',
      '<h2>実績 ',
    ].map((needle) => html.indexOf(needle));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('称号・実績名・クエストの title をエスケープする', () => {
    const payload = '<script>alert(1)</script>';
    const html = renderGamePage(
      model({
        level: {
          level: 5,
          title: payload,
          totalXp: 995,
          levelFloorXp: 894,
          nextLevelXp: 1176,
          xpToNext: 181,
          ratio: 0.358,
        },
        achievements: [
          achievement({
            definition: {
              id: 'x',
              name: payload,
              description: payload,
              icon: payload,
              xp: 10,
              tier: 'gold',
            },
            detail: payload,
          }),
        ],
        quests: [quest({ title: payload, why: payload, target: payload })],
        deltas: [delta({ label: payload })],
      }),
      GENERATED_AT,
    );
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('SVG の軸ラベルに入る日付もエスケープする', () => {
    const payload = '<script>x</script>';
    const html = renderGamePage(
      model({
        history: [snapshot({ date: payload }), snapshot({ date: '2026-10-11' })],
      }),
      GENERATED_AT,
    );
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt;');
  });

  it('deltas が空なら案内を出し、例外を投げない', () => {
    const html = renderGamePage(model({ deltas: [] }), GENERATED_AT);
    expect(html).toContain('class="empty"');
    expect(html).toContain('で記録を積むと、ここに伸びが出ます');
    expect(html).not.toContain('±0 XP');
  });

  it('比較元のない差分は 0 を並べず理由を書く', () => {
    const html = renderGamePage(
      model({ deltas: [delta({ fromDate: null, days: 0, xp: 0, level: 0, skillAverage: 0, posts: 0, milestonesDone: 0, goalsDone: 0, newAchievements: [] })] }),
      GENERATED_AT,
    );
    expect(html).toContain('比較できる記録がまだありません');
    expect(html).not.toContain('class="delta-grid"');
  });

  it('増減に応じた修飾クラスを付ける', () => {
    const html = renderGamePage(
      model({ deltas: [delta({ xp: 120, level: 0, posts: -1 })] }),
      GENERATED_AT,
    );
    expect(html).toContain('class="delta delta--up"');
    expect(html).toContain('class="delta delta--flat"');
    expect(html).toContain('class="delta delta--down"');
    expect(html).toContain('+120 XP');
    expect(html).toContain('±0');
    expect(html).toContain('-1 本');
  });

  it.each([0, 1])('history が %i 件ならスパークラインを描かず案内を出す', (count) => {
    const html = renderGamePage(
      model({ history: count === 0 ? [] : [snapshot()] }),
      GENERATED_AT,
    );
    expect(html).not.toContain('<polyline');
    expect(html).not.toContain('class="spark"');
    expect(html).toContain('class="empty"');
    expect(html).toContain('XP の推移グラフは記録が 2 件以上');
  });

  it('history が 2 件以上なら折れ線を描く', () => {
    const html = renderGamePage(model(), GENERATED_AT);
    expect(html).toMatch(/<polyline|<path/);
    expect(html).toContain('class="spark"');
    // 軸ラベルは最初と最後の日付のみ（中間の日付は出さない）
    expect(html).toContain('2026-07-01');
    expect(html).toContain('2026-10-11');
  });

  it('レベルアップした記録に印を付ける', () => {
    const html = renderGamePage(
      model({
        history: [snapshot({ date: '2026-07-01', level: 4 }), snapshot({ date: '2026-10-11', level: 5 })],
      }),
      GENERATED_AT,
    );
    expect(html).toContain('<circle');
    expect(html).toContain('丸い印（1 個）');
  });

  it('同じ日付の記録が並んでも座標が NaN にならない', () => {
    const html = renderGamePage(
      model({
        history: [snapshot({ date: '2026-10-11' }), snapshot({ date: '2026-10-11' })],
      }),
      GENERATED_AT,
    );
    expect(html).not.toContain('NaN');
    expect(html).toContain('<polyline');
  });

  it('XP が横ばいの履歴でも描ける', () => {
    const flat = { skills: 0, goals: 0, roadmap: 0, blog: 0, achievements: 0, total: 0 };
    const html = renderGamePage(
      model({
        history: [snapshot({ date: '2026-09-01', xp: flat }), snapshot({ date: '2026-10-01', xp: flat })],
      }),
      GENERATED_AT,
    );
    expect(html).not.toContain('NaN');
    expect(html).toContain('<polyline');
  });

  it('quests が 0 件でも例外を投げず案内を出す', () => {
    const html = renderGamePage(model({ quests: [] }), GENERATED_AT);
    expect(html).toContain('手当てが必要なことはありません');
    expect(html).not.toContain('class="quest-list"');
  });

  it('クエストの緊急度を修飾クラスとテキストの両方で示す', () => {
    const html = renderGamePage(
      model({
        quests: [
          quest({ urgency: 'now' }),
          quest({ id: 'b', urgency: 'soon' }),
          quest({ id: 'c', urgency: 'later' }),
        ],
      }),
      GENERATED_AT,
    );
    expect(html).toContain('class="quest quest--now"');
    expect(html).toContain('class="quest"');
    expect(html).toContain('class="quest quest--later"');
    // 色だけで意味を伝えないこと
    expect(html).toContain('今すぐ');
    expect(html).toContain('いつか');
    expect(html).toContain('+20 XP');
    expect(html).toContain('data/skills.yaml');
  });

  it('未解放の実績に is-locked を付け、解放済みには付けない', () => {
    const html = renderGamePage(model(), GENERATED_AT);
    expect(html).toContain('<li class="achievement" data-tier="bronze">');
    expect(html).toContain('<li class="achievement is-locked" data-tier="silver">');
    // 未解放も隠さない
    expect(html).toContain('継続は力');
    expect(html).toContain('3 / 10 記事');
  });

  it('解放済み件数 / 全件数を実績の見出しに出す', () => {
    const html = renderGamePage(model(), GENERATED_AT);
    expect(html).toContain('1 / 2 解放');
  });

  it('XP の内訳を領域別に出す', () => {
    const html = renderGamePage(model(), GENERATED_AT);
    expect(html).toContain('<table class="table">');
    for (const label of ['スキル', '目標', 'ロードマップ', 'ブログ', '実績', '合計']) {
      expect(html).toContain(`<td>${label}</td>`);
    }
    expect(html).toContain('995');
  });

  it('XP の合計が 0 でも割合計算で NaN を出さない', () => {
    const zero = { skills: 0, goals: 0, roadmap: 0, blog: 0, achievements: 0, total: 0 };
    const html = renderGamePage(model({ xp: zero }), GENERATED_AT);
    expect(html).not.toContain('NaN');
  });
});

describe('xp-bar__fill の幅', () => {
  function heroWidth(ratio: number): number[] {
    const base = model();
    const html = renderGameHero({ ...base, level: { ...base.level, ratio } });
    return widths(html, 'xp-bar__fill');
  }

  it.each([0, 0.5, 1])('ratio %f をそのまま百分率にする', (ratio) => {
    const [width] = heroWidth(ratio);
    expect(width).toBe(ratio * 100);
  });

  it.each([-1, -0.0001, 1.7, 42, Number.NaN, Number.POSITIVE_INFINITY])(
    '想定外の ratio %f でも 0-100 に収める',
    (ratio) => {
      const [width] = heroWidth(ratio);
      expect(width).toBeGreaterThanOrEqual(0);
      expect(width).toBeLessThanOrEqual(100);
    },
  );

  it('ページ内のすべての bar-fill が 0-100 に収まる', () => {
    const base = model();
    const html = renderGamePage(
      {
        ...base,
        level: { ...base.level, ratio: 9 },
        achievements: [achievement({ unlocked: false, progress: 7, detail: '進捗' })],
      },
      GENERATED_AT,
    );
    for (const width of [...widths(html, 'xp-bar__fill'), ...widths(html, 'bar-fill')]) {
      expect(width).toBeGreaterThanOrEqual(0);
      expect(width).toBeLessThanOrEqual(100);
    }
  });
});

describe('renderGameHero', () => {
  it('section.hero の断片を返す（ダッシュボードに差し込めること）', () => {
    const html = renderGameHero(model());
    expect(html.startsWith('<section class="hero">')).toBe(true);
    expect(html.trimEnd().endsWith('</section>')).toBe(true);
    expect(html).not.toContain('<!doctype');
  });

  it('レベル・称号・次のレベルまでの XP を出す', () => {
    const html = renderGameHero(model());
    expect(html).toContain('<span class="level-badge__num">5</span>');
    expect(html).toContain('<span class="level-badge__label">LEVEL</span>');
    expect(html).toContain('一人前');
    expect(html).toContain('次のレベルまであと 181 XP');
    expect(html).toContain('Lv.5 → Lv.6');
    expect(html).toContain('累計 995 XP');
  });

  it('0 のストリークは streak--idle にする', () => {
    const html = renderGameHero(model());
    expect(html).toContain('<li class="streak">');
    expect(html).toContain('<li class="streak streak--idle">');
    // 絵文字だけで意味を伝えない
    expect(html).toContain('連続投稿');
    expect(html).toContain('連続棚卸し');
  });

  it('途切れそうな継続を警告として出す', () => {
    const html = renderGameHero(model());
    expect(html).toContain('badge--risk');
    expect(html).toContain('今週はまだ記事がありません');
  });

  it('ページとダッシュボードで同じヒーローを使う', () => {
    const data = model();
    expect(renderGamePage(data, GENERATED_AT)).toContain(renderGameHero(data));
  });
});

describe('renderGameCard', () => {
  it('section.card から始まる', () => {
    const html = renderGameCard(model());
    expect(html.trimStart().startsWith('<section class="card">')).toBe(true);
    expect(html.trimEnd().endsWith('</section>')).toBe(true);
  });

  it('見出しを game.html へのリンクにし、要点を簡潔に出す', () => {
    const html = renderGameCard(model());
    expect(html).toContain('<a href="game.html">成長</a>');
    expect(html).toContain('Lv.5 一人前');
    expect(html).toContain('次のレベルまであと 181 XP');
    expect(html).toContain('+120 XP');
    expect(html).toContain('実績 1 / 2 解放');
  });

  it('差分がなければ記録を積む案内に差し替える', () => {
    const html = renderGameCard(model({ deltas: [] }));
    expect(html).toContain('比較できる記録がまだありません');
    expect(html).not.toContain('XP</span> レベル');
  });

  it('称号をエスケープする', () => {
    const base = model();
    const html = renderGameCard({
      ...base,
      level: { ...base.level, title: '<img src=x onerror=alert(1)>' },
    });
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });
});

describe('renderGameMarkdown', () => {
  it('## 成長 から始まる', () => {
    expect(renderGameMarkdown(model()).startsWith('## 成長')).toBe(true);
  });

  it('レベル・称号・累計 XP・差分・実績・クエストを含む', () => {
    const md = renderGameMarkdown(model());
    expect(md).toContain('- レベル: 5（一人前）');
    expect(md).toContain('- 累計 XP: 995');
    expect(md).toContain('| 前回の記録から |');
    expect(md).toContain('✍️ 最初の一歩');
    expect(md).toContain('Terraform のモジュール化を進める');
  });

  it('クエストは上位 3 件に絞る', () => {
    const quests = Array.from({ length: 5 }, (_, index) =>
      quest({ id: `q-${index}`, title: `クエスト${index}` }),
    );
    const md = renderGameMarkdown(model({ quests }));
    expect(md).toContain('クエスト0');
    expect(md).toContain('クエスト2');
    expect(md).not.toContain('クエスト3');
  });

  it('テーブルのセルに含まれる | と改行を無害化する', () => {
    const md = renderGameMarkdown(
      model({ deltas: [delta({ label: 'a | b\nc' })] }),
    );
    const row = md.split('\n').find((line) => line.includes('a \\| b'));
    expect(row).toBeDefined();
    expect(row).toContain('a \\| b c');
  });

  it('差分・実績・クエストが空でも壊れない', () => {
    const md = renderGameMarkdown(
      model({ deltas: [], achievements: [], quests: [], history: [] }),
    );
    expect(md).toContain('## 成長');
    expect(md).toContain('比較できる記録がまだありません');
    expect(md).toContain('まだありません。');
    expect(md).toContain('手当てが必要なことはありません');
  });

  it('同じ入力なら必ず同じ出力になる（週次ビルドで無意味な差分を出さない）', () => {
    const data = model();
    expect(renderGameMarkdown(data)).toBe(renderGameMarkdown(data));
  });
});

describe('CSS クラスの整合性', () => {
  const css = readFileSync(new URL('../assets/style.css', import.meta.url), 'utf8');
  const defined = new Set(
    [...css.matchAll(/\.([a-zA-Z][a-zA-Z0-9_-]*)/g)].map((match) => match[1] ?? ''),
  );

  it('style.css に定義済みのクラスだけを使う', () => {
    const html = renderGamePage(model(), GENERATED_AT);
    const used = [...classTokens(html)];
    expect(used.length).toBeGreaterThan(10);
    expect(used.filter((token) => !defined.has(token))).toEqual([]);
  });

  it('カード・ヒーローの断片も定義済みクラスだけを使う', () => {
    const data = model();
    const used = [...classTokens(renderGameCard(data)), ...classTokens(renderGameHero(data))];
    expect(used.filter((token) => !defined.has(token))).toEqual([]);
  });

  it('空データの経路で使うクラスも定義済みである', () => {
    const html = renderGamePage(
      model({ deltas: [], history: [], quests: [], achievements: [] }),
      GENERATED_AT,
    );
    expect([...classTokens(html)].filter((token) => !defined.has(token))).toEqual([]);
  });
});
