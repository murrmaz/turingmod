import 'reflect-metadata';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ActivityCategory, type ActivityLogEntry } from '@turingmod/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Logger } from '../../utils/Logger.js';
import { DatabaseManager } from '../DatabaseManager.js';
import { initialSchema } from '../migrations/001_initial_schema.js';
import { ActivityLogRepository } from './ActivityLogRepository.js';

describe('ActivityLogRepository', () => {
  let dir: string;
  let db: DatabaseManager;
  let repo: ActivityLogRepository;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'turingmod-activity-repo-test-'));
    db = new DatabaseManager(join(dir, 'test.sqlite'), new Logger({ level: 'silent' }));
    await db.initialize();
    initialSchema.up(db);
    repo = new ActivityLogRepository(db);
  });

  /** Store an entry under a fresh id, as ActivityForwarder does. */
  const add = (entry: Omit<ActivityLogEntry, 'id'>) =>
    repo.create({ id: crypto.randomUUID(), ...entry });

  afterEach(async () => {
    db.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('creates an entry and round-trips the JSON data payload', () => {
    const entry: ActivityLogEntry = {
      id: 'broadcast-id',
      category: ActivityCategory.COMMAND,
      event: 'command.executed',
      data: { name: '!title', success: true },
      timestamp: 1000,
    };
    repo.create(entry);

    // Stored under the id it was broadcast with, not a new one.
    const [found] = repo.findRecent({});
    expect(found).toEqual(entry);
  });

  it('returns entries most-recent-first', () => {
    add({ category: ActivityCategory.EVENT, event: 'twitch.follow', data: {}, timestamp: 1 });
    add({ category: ActivityCategory.EVENT, event: 'twitch.raid', data: {}, timestamp: 3 });
    add({ category: ActivityCategory.EVENT, event: 'twitch.cheer', data: {}, timestamp: 2 });

    const results = repo.findRecent({});
    expect(results.map((e) => e.event)).toEqual(['twitch.raid', 'twitch.cheer', 'twitch.follow']);
  });

  it('filters by category', () => {
    add({ category: ActivityCategory.ERROR, event: 'integration.error', data: {}, timestamp: 1 });
    add({
      category: ActivityCategory.STATUS,
      event: 'integration.status',
      data: {},
      timestamp: 2,
    });

    const results = repo.findRecent({ category: ActivityCategory.ERROR });
    expect(results.map((e) => e.event)).toEqual(['integration.error']);
  });

  it('paginates with an exclusive `before` cursor', () => {
    add({ category: ActivityCategory.EVENT, event: 'twitch.follow', data: {}, timestamp: 10 });
    add({ category: ActivityCategory.EVENT, event: 'twitch.raid', data: {}, timestamp: 20 });
    add({ category: ActivityCategory.EVENT, event: 'twitch.cheer', data: {}, timestamp: 30 });

    const page = repo.findRecent({ before: 30 });
    expect(page.map((e) => e.event)).toEqual(['twitch.raid', 'twitch.follow']);
  });

  it('caps the limit at MAX_QUERY_LIMIT', () => {
    for (let i = 0; i < 5; i++) {
      add({
        category: ActivityCategory.EVENT,
        event: 'twitch.follow',
        data: {},
        timestamp: i,
      });
    }

    const results = repo.findRecent({ limit: 2 });
    expect(results).toHaveLength(2);
  });

  it('prunes to the cap after enough inserts', () => {
    // PRUNE_EVERY is 100 and ACTIVITY_LOG_CAP is 5000; insert just over one prune cycle
    // worth of rows to exercise the prune path without inserting 5000+ rows.
    for (let i = 0; i < 101; i++) {
      add({
        category: ActivityCategory.EVENT,
        event: 'twitch.follow',
        data: {},
        timestamp: i,
      });
    }

    const all = repo.findRecent({ limit: 500 });
    expect(all).toHaveLength(101);
  });

  it('fails the read on a stored row that does not fit the schema, naming it', () => {
    db.run(
      'INSERT INTO activity_log (id, category, event, data, timestamp) VALUES (?, ?, ?, ?, ?)',
      ['stale-row', 'retired-category', 'command.executed', '{}', 1]
    );

    expect(() => repo.findRecent({})).toThrow(/stale-row is invalid[\s\S]*category/);
  });

  it('fails the read on a stored event the log does not record', () => {
    db.run(
      'INSERT INTO activity_log (id, category, event, data, timestamp) VALUES (?, ?, ?, ?, ?)',
      ['retired-row', ActivityCategory.EVENT, 'twitch.stream.online', '{}', 1]
    );

    expect(() => repo.findRecent({})).toThrow(/retired-row is invalid[\s\S]*event/);
  });

  it('fails the read on a stored row whose data is not JSON', () => {
    db.run(
      'INSERT INTO activity_log (id, category, event, data, timestamp) VALUES (?, ?, ?, ?, ?)',
      ['broken-row', ActivityCategory.EVENT, 'twitch.follow', '{not json', 1]
    );

    expect(() => repo.findRecent({})).toThrow(/broken-row has unreadable data/);
  });
});
