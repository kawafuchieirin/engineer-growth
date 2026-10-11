import { copyFile, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { assertSkillReferences } from '../lib/consistency.ts';
import { toJstDate, toJstTimestamp } from '../lib/date.ts';
import { writeOut } from '../lib/io.ts';
import { paths } from '../lib/paths.ts';
import { loadBlogModel } from '../lib/blog.ts';
import { loadGoalsModel } from '../lib/goals.ts';
import { assertGoalReferences, loadRoadmapModel } from '../lib/roadmap.ts';
import { loadSkillsModel } from '../lib/skills.ts';
import { renderBlogCard, renderBlogIndexPage, renderBlogPostPages, renderBlogMarkdown } from '../render/blog.ts';
import { renderDashboardPage } from '../render/dashboard.ts';
import { renderGoalsCard, renderGoalsMarkdown, renderGoalsPage } from '../render/goals.ts';
import { renderProfileMarkdown } from '../render/profile.ts';
import { renderRoadmapCard, renderRoadmapMarkdown, renderRoadmapPage } from '../render/roadmap.ts';
import { renderSkillsCard, renderSkillsMarkdown, renderSkillsPage } from '../render/skills.ts';
import type { Command } from './types.ts';

export const buildCommand: Command = {
  name: 'build',
  summary: '静的サイト (dist/) と PROFILE.md を生成する',
  async run({ log, now }) {
    const generatedAt = toJstTimestamp(now);

    // 基準日は 1 つだけ作って全領域に渡す。各モデルが個別に new Date() を呼ぶと
    // 日付境界をまたいだときにフッタと本文の基準日が食い違い、ビルドが非決定的になる。
    const [skills, goals, roadmap, blog] = await Promise.all([
      loadSkillsModel(now),
      loadGoalsModel(now),
      loadRoadmapModel(now),
      loadBlogModel(now),
    ]);
    assertSkillReferences(skills.ids, [goals, roadmap, blog]);
    assertGoalReferences(goals.ids, [roadmap]);

    await rm(paths.dist, { recursive: true, force: true });
    await mkdir(resolve(paths.dist, 'assets'), { recursive: true });
    await copyFile(resolve(paths.root, 'assets', 'style.css'), resolve(paths.dist, 'assets', 'style.css'));

    await writeOut(
      resolve(paths.dist, 'index.html'),
      renderDashboardPage({
        generatedAt,
        cards: [
          renderSkillsCard(skills),
          renderGoalsCard(goals),
          renderRoadmapCard(roadmap),
          renderBlogCard(blog),
        ],
      }),
    );
    await writeOut(resolve(paths.dist, 'skills.html'), renderSkillsPage(skills, generatedAt));
    await writeOut(resolve(paths.dist, 'goals.html'), renderGoalsPage(goals, generatedAt));
    await writeOut(resolve(paths.dist, 'roadmap.html'), renderRoadmapPage(roadmap, generatedAt));
    await writeOut(resolve(paths.dist, 'blog', 'index.html'), renderBlogIndexPage(blog, generatedAt));

    for (const page of renderBlogPostPages(blog, generatedAt)) {
      await writeOut(resolve(paths.dist, 'blog', page.fileName), page.html);
    }

    await writeOut(
      paths.profile,
      renderProfileMarkdown({
        generatedOn: toJstDate(now),
        sections: [
          renderSkillsMarkdown(skills),
          renderGoalsMarkdown(goals),
          renderRoadmapMarkdown(roadmap),
          renderBlogMarkdown(blog),
        ],
      }),
    );

    log(`dist/ を生成しました (ブログ記事 ${blog.posts.length} 件)`);
    log('PROFILE.md を更新しました');
  },
};
