import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parse } from 'yaml';
import type { ZodType } from 'zod';
import { GrowthError } from './errors.ts';

/**
 * YAML を読み込み、スキーマで検証して返す。
 * 失敗時は「どのファイルの・どのフィールドが・なぜ」駄目なのかを明示する。
 */
export async function readYaml<T>(filePath: string, schema: ZodType<T>): Promise<T> {
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch (cause) {
    throw new GrowthError(`データファイルを読み込めません: ${filePath}`, [
      cause instanceof Error ? cause.message : String(cause),
    ]);
  }

  let parsed: unknown;
  try {
    parsed = parse(raw);
  } catch (cause) {
    throw new GrowthError(`YAML の構文エラー: ${filePath}`, [
      cause instanceof Error ? cause.message : String(cause),
    ]);
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    const details = result.error.issues.map(
      (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
    );
    throw new GrowthError(`スキーマ検証に失敗しました: ${filePath}`, details);
  }
  return result.data;
}

/** 親ディレクトリを作りつつファイルを書き出す。 */
export async function writeOut(filePath: string, contents: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, contents.endsWith('\n') ? contents : `${contents}\n`, 'utf8');
}

/** ディレクトリ内のファイル一覧（指定拡張子のみ、名前順）。存在しなければ空配列。 */
export async function listFiles(dir: string, ext: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(ext))
      .map((entry) => entry.name)
      .sort();
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw cause;
  }
}

export { readFile };
