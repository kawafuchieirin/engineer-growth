#!/usr/bin/env node
import { buildCommand } from './commands/build.ts';
import { newPostCommand } from './commands/new-post.ts';
import { skillsReportCommand } from './commands/skills-report.ts';
import { validateCommand } from './commands/validate.ts';
import type { Command } from './commands/types.ts';
import { GrowthError } from './lib/errors.ts';

const commands: Command[] = [validateCommand, buildCommand, newPostCommand, skillsReportCommand];

function printUsage(): void {
  console.log('使い方: pnpm growth <command> [options]\n');
  console.log('コマンド:');
  const width = Math.max(...commands.map((c) => c.name.length));
  for (const command of commands) {
    console.log(`  ${command.name.padEnd(width)}  ${command.summary}`);
  }
  console.log('\n各コマンドの詳細: pnpm growth <command> --help');
}

async function main(argv: string[]): Promise<number> {
  const [name, ...args] = argv;

  if (!name || name === '--help' || name === '-h' || name === 'help') {
    printUsage();
    return 0;
  }

  const command = commands.find((candidate) => candidate.name === name);
  if (!command) {
    console.error(`未知のコマンド: ${name}\n`);
    printUsage();
    return 1;
  }

  if (args.includes('--help') || args.includes('-h')) {
    console.log(command.usage ?? `${command.name}: ${command.summary}`);
    return 0;
  }

  try {
    await command.run({ args, log: (message) => console.log(message), now: new Date() });
    return 0;
  } catch (error) {
    if (error instanceof GrowthError) {
      console.error(`エラー: ${error.message}`);
      for (const detail of error.details) console.error(`  - ${detail}`);
      return 1;
    }
    throw error;
  }
}

process.exitCode = await main(process.argv.slice(2));
