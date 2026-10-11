export interface CommandContext {
  /** サブコマンド名より後ろの引数。 */
  args: string[];
  /** 標準出力への 1 行出力。テストでは差し替える。 */
  log: (message: string) => void;
  /** 現在時刻。テストから固定できるように引数で渡す。 */
  now: Date;
}

export interface Command {
  name: string;
  summary: string;
  usage?: string;
  run: (ctx: CommandContext) => Promise<void>;
}
