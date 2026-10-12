import 'reflect-metadata';
import { parseArgs } from 'node:util';
import { DatabaseManager } from '../database/DatabaseManager.js';
import { ALL_MIGRATIONS } from '../database/migrations/index.js';
import { MigrationRunner } from '../database/migrations/MigrationRunner.js';
import { BannedWordRepository } from '../database/repositories/BannedWordRepository.js';
import { CounterRepository } from '../database/repositories/CounterRepository.js';
import { IntervalMessageRepository } from '../database/repositories/IntervalMessageRepository.js';
import { resolveDbPath } from '../utils/Config.js';
import { Logger } from '../utils/Logger.js';
import {
  importOriginalData,
  type OriginalData,
  readBannedWords,
  readOriginalDatabase,
} from './originalData.js';

const USAGE = `Import the original TuringMod's data into this TuringMod's database.

  npm run import:original -w @turingmod/backend -- --db <original.db> [options]

Options:
  --db <path>             The original bot's SQLite database (it used G:/sqlite3/test.db)
  --banned-words <path>   The original's data/banned_words.json
  --dry-run               Report what would be imported without writing anything

Writes to the database TuringMod itself uses (DB_PATH, or turingmod.db in the working
directory). Safe to re-run: existing entries are never overwritten.`;

/** Thrown to roll back a dry run's transaction. */
class DryRun extends Error {}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      db: { type: 'string' },
      'banned-words': { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help || !values.db) {
    process.stdout.write(`${USAGE}\n`);
    return values.help ? 0 : 1;
  }

  const data: OriginalData = {
    ...readOriginalDatabase(values.db),
    bannedWords: values['banned-words'] ? await readBannedWords(values['banned-words']) : [],
  };

  const logger = new Logger({ level: 'warn' });
  const dbPath = resolveDbPath();
  const db = new DatabaseManager(dbPath, logger);
  await db.initialize();
  try {
    await new MigrationRunner(db, logger).runMigrations([...ALL_MIGRATIONS]);

    let report: string[] = [];
    try {
      await db.transaction(async () => {
        report = await importOriginalData(data, {
          bannedWords: new BannedWordRepository(db),
          counters: new CounterRepository(db),
          intervalMessages: new IntervalMessageRepository(db),
        });
        if (values['dry-run']) throw new DryRun();
      });
    } catch (error) {
      if (!(error instanceof DryRun)) throw error;
    }

    const heading = values['dry-run']
      ? `Dry run against ${dbPath} (nothing written):`
      : `Imported into ${dbPath}:`;
    process.stdout.write(`${[heading, ...report].join('\n')}\n`);
    return 0;
  } finally {
    db.close();
  }
}

process.exitCode = await main();
