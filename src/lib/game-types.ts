/**
 * ゲーム要素（XP・レベル・実績・クエスト・履歴）の型定義。
 *
 * 実装を分割しても形が崩れないよう、型だけをここに置く。
 * 実行時の依存を持たないので、どのモジュールからも循環なく import できる。
 *
 * 設計の前提: XP は data/ と blog/ から機械的に導出するだけで、手入力の余地を作らない。
 * XP を増やす唯一の方法が「実際にスキルを上げる・KR を進める・記事を書く」であることが、
 * この仕組みが自分を騙す道具にならないための条件。
 */

/** XP の内訳。どの活動が効いたのかを見せるために領域ごとに分けて持つ。 */
export interface XpBreakdown {
  skills: number;
  goals: number;
  roadmap: number;
  blog: number;
  achievements: number;
  total: number;
}

/** 現在のプレイヤーレベルと、次のレベルまでの距離。 */
export interface LevelInfo {
  level: number;
  /** レベル帯に対応する称号（例: 一人前）。 */
  title: string;
  /** 累計 XP。 */
  totalXp: number;
  /** 現在のレベルに到達するために必要だった累計 XP。 */
  levelFloorXp: number;
  /** 次のレベルに必要な累計 XP。上限がなければ常に数値。 */
  nextLevelXp: number;
  /** 次のレベルまでの残り XP。 */
  xpToNext: number;
  /** 現在のレベル内での進捗（0-1）。進捗バーに使う。 */
  ratio: number;
}

/** 継続の記録。途切れさせたくない気持ちを使うので、判定の根拠を必ず添える。 */
export interface StreakInfo {
  /** 連続で記事を書いた週数（基準日の週を含む）。 */
  blogWeeks: number;
  /** 記事を書いた月が連続している数。 */
  blogMonths: number;
  /** 棚卸し（owner.updated）が連続して更新された四半期数。 */
  inventoryQuarters: number;
  /** 今週まだ記事を書いていないなど、途切れる手前の警告。 */
  atRisk: ReadonlyArray<string>;
}

/** 実績（バッジ）の定義。条件はロジックなのでコード側に持つ。 */
export interface AchievementDefinition {
  id: string;
  name: string;
  /** 何をすると解放されるか。未解放でもヒントとして見せる。 */
  description: string;
  /** 絵文字 1 文字。外部アセットを増やさずに視覚的な差を作る。 */
  icon: string;
  /** 解放時に加算される XP。 */
  xp: number;
  /** 難易度の帯。表示の並び順に使う。 */
  tier: 'bronze' | 'silver' | 'gold' | 'platinum';
}

/** 実績の達成状況。未解放のものも進捗付きで返して「あと一歩」を見せる。 */
export interface AchievementStatus {
  definition: AchievementDefinition;
  unlocked: boolean;
  /** 条件に対する進捗（0-1）。段階のない実績は 0 か 1。 */
  progress: number;
  /** 「3 / 10 記事」のような進捗の説明。 */
  detail: string;
}

/** 次の一手。やることが明確で、やれば XP が増えると分かる形にする。 */
export interface Quest {
  id: string;
  /** 何をするか。命令形で短く。 */
  title: string;
  /** なぜ今これなのか。納得できないクエストは無視されるので必須。 */
  why: string;
  /** 完了したら増える見込みの XP。 */
  xp: number;
  /** 編集するファイル（例: data/skills.yaml）。迷いをなくす。 */
  target: string;
  kind: 'skill' | 'goal' | 'roadmap' | 'blog' | 'hygiene';
  /** 緊急度。期限切れが近いものを上に出す。 */
  urgency: 'now' | 'soon' | 'later';
}

/** ある時点の記録。append-only で data/history.yaml に積む。 */
export interface Snapshot {
  date: string;
  xp: XpBreakdown;
  level: number;
  skillAverage: number;
  skillCount: number;
  posts: number;
  milestonesDone: number;
  goalsDone: number;
  achievements: ReadonlyArray<string>;
}

/** 2 つのスナップショットの差。「伸びた」を数字で見せるための中核。 */
export interface GrowthDelta {
  /** 比較対象の期間の説明（例: 前回の記録から / 直近 90 日）。 */
  label: string;
  /** 比較元のスナップショットの日付。履歴が足りなければ null。 */
  fromDate: string | null;
  days: number;
  xp: number;
  level: number;
  skillAverage: number;
  posts: number;
  milestonesDone: number;
  goalsDone: number;
  /** 期間中に解放された実績の ID。 */
  newAchievements: ReadonlyArray<string>;
}

/** ゲーム要素の集約。4 領域のモデルから導出する。 */
export interface GameModel {
  xp: XpBreakdown;
  level: LevelInfo;
  streaks: StreakInfo;
  achievements: ReadonlyArray<AchievementStatus>;
  quests: ReadonlyArray<Quest>;
  /** 日付の昇順。 */
  history: ReadonlyArray<Snapshot>;
  /** 直近の記録との差と、より長い期間の差。表示順に並べる。 */
  deltas: ReadonlyArray<GrowthDelta>;
  /** 基準日時点のスナップショット（まだ履歴に積まれていない現在値）。 */
  current: Snapshot;
  today: string;
}
