/**
 * 利用者に提示する想定のエラー。CLI はこれを捕捉して
 * スタックトレースなしの読みやすいメッセージとして出力する。
 */
export class GrowthError extends Error {
  readonly details: string[];

  constructor(message: string, details: string[] = []) {
    super(message);
    this.name = 'GrowthError';
    this.details = details;
  }
}
