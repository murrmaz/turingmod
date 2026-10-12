import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import type { BannedWordRepository } from '../database/repositories/BannedWordRepository.js';
import { COUNTERS, type CounterRepository } from '../database/repositories/CounterRepository.js';
import type { IntervalMessageRepository } from '../database/repositories/IntervalMessageRepository.js';

/** What the original bot kept, as read from its SQLite database and `data/` files. */
export interface OriginalData {
  /** Chat-defined commands (`stdcommands`). Not imported — commands are code now — but reported. */
  customCommands: { name: string; message: string }[];
  /** `intervalcommands`, in table order. */
  intervalMessages: { name: string; message: string; createdBy: string | null }[];
  /** Single-row `death_count` and `voicecracks`; null if the table is missing or empty. */
  deaths: number | null;
  voiceCracks: number | null;
  /** `data/banned_words.json`: word → date banned. */
  bannedWords: { word: string; bannedAt: number }[];
}

type Row = Record<string, unknown>;

/**
 * Read the original database. Its schema isn't written down anywhere; it's inferred from the
 * original's `sqlite_db.js`, which inserts `(name, user, msg)` positionally into both command
 * tables, and reads `num` from `voicecracks` and `deaths` from `death_count`. Missing tables are
 * treated as empty, so a partial database still imports what it has.
 */
export function readOriginalDatabase(path: string): Omit<OriginalData, 'bannedWords'> {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const tables = new Set(
      (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Row[]).map(
        (row) => String(row.name)
      )
    );
    const rows = (table: string): Row[] =>
      tables.has(table) ? (db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all() as Row[]) : [];
    const firstNumber = (table: string, column: string): number | null => {
      const value = rows(table)[0]?.[column];
      const parsed = Number.parseInt(String(value), 10);
      return Number.isNaN(parsed) ? null : parsed;
    };

    return {
      customCommands: rows('stdcommands').map((row) => ({
        name: String(row.name),
        message: String(row.msg).trim(),
      })),
      intervalMessages: rows('intervalcommands').map((row) => ({
        name: String(row.name),
        message: String(row.msg).trim(),
        createdBy: creatorOf(row),
      })),
      deaths: firstNumber('death_count', 'deaths'),
      voiceCracks: firstNumber('voicecracks', 'num'),
    };
  } finally {
    db.close();
  }
}

/** The command tables' creator column is never named in the original; it's whichever is left. */
function creatorOf(row: Row): string | null {
  const value = Object.entries(row).find(([key]) => key !== 'name' && key !== 'msg')?.[1];
  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * Read `banned_words.json`, which maps each word to the date it was banned. The original wrote
 * the date as month/day/year with an inconsistently padded day ("03/5/2024"); an unreadable date
 * falls back to `fallbackDate`.
 */
export async function readBannedWords(
  path: string,
  fallbackDate = Date.now()
): Promise<OriginalData['bannedWords']> {
  const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${path} is not a word → date object`);
  }
  return Object.entries(parsed as Row).map(([word, date]) => ({
    word,
    bannedAt: parseOriginalDate(date) ?? fallbackDate,
  }));
}

function parseOriginalDate(value: unknown): number | null {
  const match = typeof value === 'string' ? /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value) : null;
  if (!match) return null;
  const [, month, day, year] = match.map(Number) as [number, number, number, number];
  return new Date(year, month - 1, day).getTime();
}

export interface ImportTargets {
  bannedWords: BannedWordRepository;
  counters: CounterRepository;
  intervalMessages: IntervalMessageRepository;
}

/**
 * Write the original's data into TuringMod's tables. Safe to run more than once: nothing that
 * already exists is overwritten — a counter that has been set (say, by a stream since the last
 * import) keeps its value — so the report says what was skipped and why.
 */
export async function importOriginalData(
  data: OriginalData,
  targets: ImportTargets
): Promise<string[]> {
  const report: string[] = [];

  let added = 0;
  for (const { name, message, createdBy } of data.intervalMessages) {
    if (await targets.intervalMessages.add(name, message, createdBy)) added++;
  }
  report.push(
    `Interval messages: ${added} imported, ${data.intervalMessages.length - added} already present`
  );

  for (const [label, name, value] of [
    ['Deaths', COUNTERS.deaths, data.deaths],
    ['Voice cracks', COUNTERS.voiceCracks, data.voiceCracks],
  ] as const) {
    if (value === null) {
      report.push(`${label}: nothing to import`);
    } else if (await targets.counters.has(name)) {
      const current = await targets.counters.get(name);
      report.push(`${label}: kept the existing ${current} (the original had ${value})`);
    } else {
      await targets.counters.set(name, value);
      report.push(`${label}: set to ${value}`);
    }
  }

  let banned = 0;
  for (const { word, bannedAt } of data.bannedWords) {
    if (await targets.bannedWords.add(word, null, bannedAt)) banned++;
  }
  report.push(
    `Banned words: ${banned} imported, ${data.bannedWords.length - banned} already present`
  );

  if (data.customCommands.length > 0) {
    report.push(
      `Custom commands to port to code (${data.customCommands.length}; not imported):`,
      ...data.customCommands.map(({ name, message }) => `  ${name} → ${message}`)
    );
  }

  return report;
}
