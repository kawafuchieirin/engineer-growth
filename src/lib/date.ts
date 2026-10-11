const JST_OFFSET_MINUTES = 9 * 60;

/** Date を JST の YYYY-MM-DD にする。 */
export function toJstDate(date: Date): string {
  const shifted = new Date(date.getTime() + JST_OFFSET_MINUTES * 60_000);
  return shifted.toISOString().slice(0, 10);
}

/** Date を JST の "YYYY-MM-DD HH:mm (JST)" にする。生成物のフッタ表示用。 */
export function toJstTimestamp(date: Date): string {
  const shifted = new Date(date.getTime() + JST_OFFSET_MINUTES * 60_000);
  return `${shifted.toISOString().slice(0, 10)} ${shifted.toISOString().slice(11, 16)} (JST)`;
}

/** YYYY-MM-DD 同士の日数差（to - from）。 */
export function daysBetween(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}
