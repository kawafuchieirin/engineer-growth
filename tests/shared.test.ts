import { describe, expect, it } from 'vitest';
import { assertSkillReferences } from '../src/lib/consistency.ts';
import { daysBetween, toJstDate, toJstTimestamp } from '../src/lib/date.ts';
import { GrowthError } from '../src/lib/errors.ts';
import { isoDate, kebabId, duplicates, link, levelsFile } from '../src/schema/common.ts';
import { escapeHtml } from '../src/render/layout.ts';
import { renderProfileMarkdown } from '../src/render/profile.ts';

describe('isoDate', () => {
  it('実在する日付を受け付ける', () => {
    expect(isoDate.parse('2026-10-11')).toBe('2026-10-11');
    expect(isoDate.parse('2024-02-29')).toBe('2024-02-29');
  });

  it.each(['2026-02-30', '2026-04-31', '2026-13-01', '2025-02-29'])(
    '存在しない日付 %s を拒否する',
    (value) => {
      const result = isoDate.safeParse(value);
      expect(result.success).toBe(false);
    },
  );

  it('書式が違う値を拒否する', () => {
    for (const value of ['2026/10/11', '26-10-11', '2026-10-11T00:00:00Z', '']) {
      expect(isoDate.safeParse(value).success).toBe(false);
    }
  });
});

describe('kebabId', () => {
  it('英小文字・数字・ハイフンのみ受け付ける', () => {
    expect(kebabId.parse('infra-terraform')).toBe('infra-terraform');
    expect(kebabId.parse('g-2026q4-iac')).toBe('g-2026q4-iac');
  });

  it.each(['Infra-Terraform', 'infra_terraform', 'infra terraform', '-infra', 'infra-', 'infra--tf'])(
    '表記揺れ %s を拒否する',
    (value) => {
      expect(kebabId.safeParse(value).success).toBe(false);
    },
  );
});

describe('duplicates', () => {
  it('2 回以上現れた値だけを 1 度ずつ返す', () => {
    expect(duplicates(['a', 'b', 'a', 'c', 'a', 'b'])).toEqual(['a', 'b']);
  });

  it('重複が無ければ空配列', () => {
    expect(duplicates(['a', 'b', 'c'])).toEqual([]);
    expect(duplicates([])).toEqual([]);
  });
});

describe('link', () => {
  it('http(s) の URL を受け付ける', () => {
    expect(link.parse({ label: '資料', url: 'https://example.com/doc' }).url).toBe(
      'https://example.com/doc',
    );
  });

  it.each(['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'file:///etc/passwd'])(
    '危険なスキーム %s を拒否する',
    (url) => {
      // escapeHtml は属性の引用符を守るだけでスキームは防がないため、ここで弾く必要がある
      expect(link.safeParse({ label: 'x', url }).success).toBe(false);
    },
  );

  it('未知のキーを拒否する', () => {
    expect(link.safeParse({ label: 'x', url: 'https://example.com', note: 'typo' }).success).toBe(
      false,
    );
  });
});

describe('levelsFile', () => {
  const valid = {
    levels: Array.from({ length: 6 }, (_, level) => ({
      level,
      name: `name-${level}`,
      description: `description-${level}`,
    })),
  };

  it('6 段階の定義を受け付ける', () => {
    expect(levelsFile.parse(valid).levels).toHaveLength(6);
  });

  it('段階数が 6 でなければ拒否する', () => {
    expect(levelsFile.safeParse({ levels: valid.levels.slice(0, 5) }).success).toBe(false);
  });
});

describe('escapeHtml', () => {
  it('HTML の特殊文字をすべてエスケープする', () => {
    expect(escapeHtml('<script>alert("x" & \'y\')</script>')).toBe(
      '&lt;script&gt;alert(&quot;x&quot; &amp; &#39;y&#39;)&lt;/script&gt;',
    );
  });

  it('& を二重エスケープしない順序で処理する', () => {
    // & を最初に置換しないと &lt; が &amp;lt; になる
    expect(escapeHtml('a & b')).toBe('a &amp; b');
    expect(escapeHtml('<')).toBe('&lt;');
  });

  it('エスケープ対象を含まない文字列はそのまま返す', () => {
    expect(escapeHtml('インフラ / SRE')).toBe('インフラ / SRE');
  });
});

describe('assertSkillReferences', () => {
  it('既知のスキル ID だけを参照していれば通る', () => {
    expect(() =>
      assertSkillReferences(['infra-terraform', 'cloud-aws'], [
        { referencedSkillIds: [{ id: 'infra-terraform', source: 'goals.yaml の g-x' }] },
      ]),
    ).not.toThrow();
  });

  it('未定義のスキル ID を参照していたら GrowthError を投げる', () => {
    expect(() =>
      assertSkillReferences(['infra-terraform'], [
        { referencedSkillIds: [{ id: 'infra-tarraform', source: 'goals.yaml の g-x' }] },
      ]),
    ).toThrow(GrowthError);
  });

  it('複数の参照元の問題をまとめて報告し、出所と ID を含める', () => {
    try {
      assertSkillReferences(
        ['infra-terraform'],
        [
          { referencedSkillIds: [{ id: 'missing-a', source: 'goals.yaml の g-x' }] },
          { referencedSkillIds: [{ id: 'missing-b', source: 'blog/posts/p.md' }] },
        ],
      );
      expect.unreachable('エラーが投げられるはず');
    } catch (error) {
      expect(error).toBeInstanceOf(GrowthError);
      const details = (error as GrowthError).details;
      expect(details).toHaveLength(2);
      expect(details.join('\n')).toContain('missing-a');
      expect(details.join('\n')).toContain('goals.yaml の g-x');
      expect(details.join('\n')).toContain('missing-b');
      expect(details.join('\n')).toContain('blog/posts/p.md');
    }
  });

  it('参照が空なら何も起きない', () => {
    expect(() => assertSkillReferences([], [{ referencedSkillIds: [] }])).not.toThrow();
  });
});

describe('date ヘルパ', () => {
  it('JST の日付に変換する（UTC 深夜は翌日になる）', () => {
    expect(toJstDate(new Date('2026-10-11T00:00:00Z'))).toBe('2026-10-11');
    expect(toJstDate(new Date('2026-10-11T15:30:00Z'))).toBe('2026-10-12');
  });

  it('JST のタイムスタンプを表示用に整形する', () => {
    expect(toJstTimestamp(new Date('2026-10-11T12:27:00Z'))).toBe('2026-10-11 21:27 (JST)');
  });

  it('日数差を符号付きで返す', () => {
    expect(daysBetween('2026-10-01', '2026-10-11')).toBe(10);
    expect(daysBetween('2026-10-11', '2026-10-01')).toBe(-10);
    expect(daysBetween('2026-10-11', '2026-10-11')).toBe(0);
  });

  it('月や年をまたいでも正しく数える', () => {
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
    expect(daysBetween('2024-02-28', '2024-03-01')).toBe(2); // 閏年
  });
});

describe('renderProfileMarkdown', () => {
  it('生成物であることの注意書きと日付を含める', () => {
    const output = renderProfileMarkdown({
      generatedOn: '2026-10-11',
      sections: ['## スキル\n\n本文'],
    });
    expect(output).toContain('直接編集しないでください');
    expect(output).toContain('最終更新: 2026-10-11');
    expect(output).toContain('## スキル');
  });

  it('同じ入力なら必ず同じ出力になる（週次ビルドで無意味な差分を出さない）', () => {
    const input = { generatedOn: '2026-10-11', sections: ['## スキル\n\n本文'] };
    expect(renderProfileMarkdown(input)).toBe(renderProfileMarkdown(input));
  });

  it('節が空でも壊れない', () => {
    expect(renderProfileMarkdown({ generatedOn: '2026-10-11', sections: [] })).toContain(
      '# エンジニア成長プロファイル',
    );
  });
});
