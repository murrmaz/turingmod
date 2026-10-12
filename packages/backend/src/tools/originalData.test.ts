import 'reflect-metadata';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseManager } from '../database/DatabaseManager.js';
import { BannedWordRepository } from '../database/repositories/BannedWordRepository.js';
import { COUNTERS, CounterRepository } from '../database/repositories/CounterRepository.js';
import { IntervalMessageRepository } from '../database/repositories/IntervalMessageRepository.js';
import { SuggestionRepository } from '../database/repositories/SuggestionRepository.js';
import { createTestDatabase } from '../database/repositories/testDatabase.js';
import {
  importOriginalData,
  type OriginalData,
  readBannedWords,
  readOriginalDatabase,
  readSuggestions,
} from './originalData.js';

/** An original-bot database, shaped the way its sqlite_db.js reads and writes it. */
function createOriginalDatabase(path: string, { withCounters = true } = {}) {
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE stdcommands (name TEXT, user TEXT, msg TEXT);
    CREATE TABLE intervalcommands (name TEXT, user TEXT, msg TEXT);
    CREATE TABLE twitch_auth (access_token TEXT, refresh_token TEXT);
    INSERT INTO stdcommands VALUES ('!discord', 'pope_pontius', 'Join the discord at example.com ');
    INSERT INTO intervalcommands VALUES ('socials', 'pope_pontius', 'Follow me everywhere ');
    INSERT INTO intervalcommands VALUES ('prime', 'a_mod', 'Subscribe with Prime ');
    INSERT INTO twitch_auth VALUES ('secret', 'secret');
  `);
  if (withCounters) {
    // The original stored the voice crack count as text.
    db.exec(`
      CREATE TABLE death_count (deaths INTEGER);
      CREATE TABLE voicecracks (num TEXT);
      INSERT INTO death_count VALUES (12);
      INSERT INTO voicecracks VALUES ('57');
    `);
  }
  db.close();
}

describe('original data import', () => {
  let dir: string;
  let db: DatabaseManager;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'original-'));
    ({ db, cleanup } = await createTestDatabase());
  });

  afterEach(async () => {
    await cleanup();
    await rm(dir, { recursive: true, force: true });
  });

  const targets = () => ({
    bannedWords: new BannedWordRepository(db),
    counters: new CounterRepository(db),
    intervalMessages: new IntervalMessageRepository(db),
    suggestions: new SuggestionRepository(db),
  });

  it("reads the original's tables, trimming the trailing space it saved messages with", () => {
    const path = join(dir, 'test.db');
    createOriginalDatabase(path);

    expect(readOriginalDatabase(path)).toEqual({
      customCommands: [{ name: '!discord', message: 'Join the discord at example.com' }],
      intervalMessages: [
        { name: 'socials', message: 'Follow me everywhere', createdBy: 'pope_pontius' },
        { name: 'prime', message: 'Subscribe with Prime', createdBy: 'a_mod' },
      ],
      deaths: 12,
      voiceCracks: 57,
    });
  });

  it('treats missing tables as empty', () => {
    const path = join(dir, 'partial.db');
    createOriginalDatabase(path, { withCounters: false });

    expect(readOriginalDatabase(path)).toMatchObject({ deaths: null, voiceCracks: null });
  });

  it('reads suggestions.txt one per line, skipping blanks', async () => {
    const path = join(dir, 'suggestions.txt');
    await writeFile(path, 'a quote command\r\n\nmore bonk\n');

    expect(await readSuggestions(path)).toEqual(['a quote command', 'more bonk']);
  });

  it("reads banned_words.json, including the original's unpadded day", async () => {
    const path = join(dir, 'banned_words.json');
    await writeFile(path, JSON.stringify({ cheese: '03/5/2024', moist: 'not a date' }));

    expect(await readBannedWords(path, 42)).toEqual([
      { word: 'cheese', bannedAt: new Date(2024, 2, 5).getTime() },
      { word: 'moist', bannedAt: 42 },
    ]);
  });

  const data: OriginalData = {
    customCommands: [{ name: '!discord', message: 'Join the discord' }],
    intervalMessages: [{ name: 'socials', message: 'Follow me', createdBy: 'pope_pontius' }],
    deaths: 12,
    voiceCracks: 57,
    bannedWords: [{ word: 'cheese', bannedAt: 1000 }],
    suggestions: ['add a quote command'],
  };

  it('imports everything and lists custom commands to port by hand', async () => {
    const report = await importOriginalData(data, targets());

    expect(await targets().intervalMessages.list()).toEqual(data.intervalMessages);
    expect(await targets().counters.get(COUNTERS.deaths)).toBe(12);
    expect(await targets().counters.get(COUNTERS.voiceCracks)).toBe(57);
    expect(await targets().bannedWords.list()).toEqual([
      { word: 'cheese', bannedBy: null, bannedAt: 1000 },
    ]);
    expect(report).toEqual([
      'Interval messages: 1 imported, 0 already present',
      'Deaths: set to 12',
      'Voice cracks: set to 57',
      'Banned words: 1 imported, 0 already present',
      'Suggestions: 1 imported, 0 already present',
      'Custom commands to port to code (1; not imported):',
      '  !discord → Join the discord',
    ]);
  });

  it('is safe to re-run, and never overwrites a count kept since', async () => {
    await importOriginalData(data, targets());
    await targets().counters.increment(COUNTERS.deaths);

    const report = await importOriginalData(data, targets());

    expect(await targets().counters.get(COUNTERS.deaths)).toBe(13);
    expect(await targets().intervalMessages.list()).toHaveLength(1);
    expect(report).toContain('Interval messages: 0 imported, 1 already present');
    expect(report).toContain('Deaths: kept the existing 13 (the original had 12)');
    expect(report).toContain('Banned words: 0 imported, 1 already present');
    expect(report).toContain('Suggestions: 0 imported, 1 already present');
  });
});
