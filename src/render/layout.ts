/** HTML の特殊文字をエスケープする。生成サイトで必ず通すこと。 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface LayoutOptions {
  title: string;
  /** サイトルートへの相対プレフィックス（例: サブディレクトリなら '../'）。 */
  base?: string;
  /** 現在のページを示すナビゲーションのキー。 */
  active?: 'index' | 'skills' | 'goals' | 'roadmap' | 'blog';
  body: string;
  generatedAt: string;
}

const NAV: ReadonlyArray<{ key: NonNullable<LayoutOptions['active']>; href: string; label: string }> = [
  { key: 'index', href: 'index.html', label: 'ダッシュボード' },
  { key: 'skills', href: 'skills.html', label: 'スキル' },
  { key: 'goals', href: 'goals.html', label: '目標' },
  { key: 'roadmap', href: 'roadmap.html', label: 'ロードマップ' },
  { key: 'blog', href: 'blog/index.html', label: 'ブログ' },
];

/** 全ページ共通の HTML シェル。配色トークンは :root で定義し、ダークモードに追従する。 */
export function layout({ title, base = '', active, body, generatedAt }: LayoutOptions): string {
  const nav = NAV.map((item) => {
    const current = item.key === active;
    return `<a class="nav-link${current ? ' is-active' : ''}" href="${base}${item.href}"${
      current ? ' aria-current="page"' : ''
    }>${escapeHtml(item.label)}</a>`;
  }).join('\n        ');

  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="${base}assets/style.css">
</head>
<body>
<header class="site-header">
  <div class="wrap">
    <a class="brand" href="${base}index.html">Engineer Growth</a>
    <nav class="site-nav">
        ${nav}
    </nav>
  </div>
</header>
<main class="wrap">
${body}
</main>
<footer class="site-footer">
  <div class="wrap">
    <p>生成日時: ${escapeHtml(generatedAt)}</p>
  </div>
</footer>
</body>
</html>`;
}
