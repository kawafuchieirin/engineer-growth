import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** リポジトリルート。src/lib からの相対位置で解決する（cwd に依存させない）。 */
export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const paths = {
  root: repoRoot,
  data: resolve(repoRoot, 'data'),
  skills: resolve(repoRoot, 'data', 'skills.yaml'),
  goals: resolve(repoRoot, 'data', 'goals.yaml'),
  roadmap: resolve(repoRoot, 'data', 'roadmap.yaml'),
  levels: resolve(repoRoot, 'data', 'levels.yaml'),
  blogPosts: resolve(repoRoot, 'blog', 'posts'),
  blogDrafts: resolve(repoRoot, 'blog', 'drafts'),
  templates: resolve(repoRoot, 'templates'),
  dist: resolve(repoRoot, 'dist'),
  profile: resolve(repoRoot, 'PROFILE.md'),
} as const;
