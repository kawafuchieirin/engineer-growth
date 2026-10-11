import { relative } from 'node:path';
import { loadBlogModel } from '../lib/blog.ts';
import { toJstDate } from '../lib/date.ts';
import { GrowthError } from '../lib/errors.ts';
import type { GrowthDelta, Snapshot } from '../lib/game-types.ts';
import { loadGoalsModel } from '../lib/goals.ts';
import {
  buildSnapshot,
  computeDeltas,
  formatHistoryYaml,
  historyPath,
  loadHistory,
  saveHistory,
  upsertSnapshot,
} from '../lib/history.ts';
import { paths } from '../lib/paths.ts';
import { loadRoadmapModel } from '../lib/roadmap.ts';
import { loadSkillsModel } from '../lib/skills.ts';
import { achievementXp, evaluateAchievements } from '../lib/achievements.ts';
import { computeStreaks } from '../lib/streaks.ts';
import type { Command, CommandContext } from './types.ts';

const USAGE = `snapshot: 現在の XP・レベル・スキル平均を data/history.yaml に記録する

使い方:
  pnpm growth snapshot [options]

オプション:
  --dry-run  書き込まずに、記録される内容と差分だけを表示する。
  --force    同じ日付の記録を上書きすることを承知している場合に付ける。
             指定しなくても上書きするが、その場合は上書きした旨を明示的に出力する。

記録は 1 日 1 件で、同じ日に何度実行してもその日の記録が最新の値に置き換わる。
過去の日付の記録は書き換えない（過去を書き換えると「伸びた」が嘘になる）。`;

/** 増減を符号付きで表示する。`+0` を出すのは「比較できたが動かなかった」ときだけ。 */
function signed(value: number): string {
  return value > 0 ? `+${value}` : `${value}`;
}

function formatDelta(delta: GrowthDelta): string {
  const parts = [
    `XP ${signed(delta.xp)}`,
    `レベル ${signed(delta.level)}`,
    `スキル平均 ${signed(delta.skillAverage)}`,
    `記事 ${signed(delta.posts)}`,
    `マイルストーン ${signed(delta.milestonesDone)}`,
    `目標達成 ${signed(delta.goalsDone)}`,
  ];
  const achievements =
    delta.newAchievements.length > 0 ? ` / 新しい実績: ${delta.newAchievements.join(', ')}` : '';
  return `  ${delta.label}（${delta.fromDate} から ${delta.days} 日）: ${parts.join(' / ')}${achievements}`;
}

function describeCurrent(snapshot: Snapshot): string[] {
  const { xp } = snapshot;
  return [
    `${snapshot.date} の記録`,
    `  レベル ${snapshot.level} / 合計 ${xp.total} XP`,
    `  内訳: スキル ${xp.skills} / 目標 ${xp.goals} / ロードマップ ${xp.roadmap} / ブログ ${xp.blog} / 実績 ${xp.achievements}`,
    `  スキル ${snapshot.skillCount} 件・平均 ${snapshot.skillAverage} / 公開記事 ${snapshot.posts} 本 / 完了マイルストーン ${snapshot.milestonesDone} / 達成した目標 ${snapshot.goalsDone}`,
  ];
}

/**
 * 現在値を履歴に記録する。
 *
 * 実行する動機は「記録した」ではなく「前回から何が増えたか」を見られることなので、
 * 書き込みの後に必ず差分を出す。差分が出せない（比較できる記録が無い）ときは、
 * 0 を並べる代わりに「次に実行すると差分が見られる」ことを伝える。
 *
 * 実績の XP は現時点では渡していない（src/lib/achievements.ts の配線後に加える）。
 * buildSnapshot が achievementXp を引数で受けるため、記録の形は変えずに後から足せる。
 */
export const snapshotCommand: Command = {
  name: 'snapshot',
  summary: '現在の XP・レベル・スキル平均を data/history.yaml に記録する',
  usage: USAGE,
  async run({ args, log, now }: CommandContext) {
    const unknown = args.filter((arg) => arg !== '--dry-run' && arg !== '--force');
    if (unknown.length > 0) {
      throw new GrowthError(`未知のオプション: ${unknown.join(', ')}`, [USAGE]);
    }
    const dryRun = args.includes('--dry-run');
    const force = args.includes('--force');

    const [skills, goals, roadmap, blog] = await Promise.all([
      loadSkillsModel(now),
      loadGoalsModel(now),
      loadRoadmapModel(now),
      loadBlogModel(now),
    ]);

    const date = toJstDate(now);
    // 履歴はストリークと実績の判定にも使うので、現在値を組む前に読む
    const history = await loadHistory();
    // 実績 XP も記録に含める。画面（game.html）と記録が同じ計算を通るよう、
    // game.ts と同じ順序（ストリーク → 実績 → XP）で評価する。
    const streaks = computeStreaks({
      postDates: blog.posts.map((post) => post.date),
      snapshotDates: history.map((snapshot) => snapshot.date),
      today: date,
    });
    const achievements = evaluateAchievements({
      skills,
      goals,
      roadmap,
      blog,
      streaks,
      historyCount: history.length,
    });
    const current = buildSnapshot({
      date,
      skills,
      goals,
      roadmap,
      blog,
      achievementXp: achievementXp(achievements),
      achievements: achievements
        .filter((status) => status.unlocked)
        .map((status) => status.definition.id),
    });
    const replaced = history.find((snapshot) => snapshot.date === date);
    const next = upsertSnapshot(history, current);
    // 比較元は履歴そのもの。当日の記録は computeDeltas が候補から外す（自分自身との差を出さない）。
    const deltas = computeDeltas(history, current);

    for (const line of describeCurrent(current)) log(line);

    if (dryRun) {
      log('');
      log(`--dry-run のため書き込みません。${relative(paths.root, historyPath)} は次の内容になります:`);
      log(formatHistoryYaml(next).trimEnd());
    } else {
      await saveHistory(next);
      log('');
      if (replaced) {
        log(
          `同じ日付 (${date}) の記録を上書きしました（合計 ${replaced.xp.total} XP → ${current.xp.total} XP）。`,
        );
        if (!force) log('  1 日 1 件に保つための上書きです。意図的な場合は --force を付けると明示できます。');
      }
      log(`記録しました: ${relative(paths.root, historyPath)}（${next.length} 件）`);
    }

    log('');
    if (deltas.length === 0) {
      log('比較できる過去の記録がまだありません。次に snapshot を実行すると差分が出ます。');
    } else {
      log('前回からの変化:');
      for (const delta of deltas) log(formatDelta(delta));
    }
  },
};
