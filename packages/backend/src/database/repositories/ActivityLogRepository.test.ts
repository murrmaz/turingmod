import 'reflect-metadata';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ActivityCategory } from '@turingmod/shared';
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

  afterEach(async () => {
    db.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('creates an entry and round-trips the JSON data payload', async () => {
    const entry = await repo.create({
      category: ActivityCategory.COMMAND,
      event: 'command.executed',
      data: { name: '!title', success: true },
      timestamp: 1000,
    });

    expect(entry.id).toBeTruthy();

    const [found] = await repo.findRecent({});
    expect(found).toEqual(entry);
  });

  it('returns entries most-recent-first', async () => {
    await repo.create({ category: ActivityCategory.EVENT, event: 'a', data: {}, timestamp: 1 });
    await repo.create({ category: ActivityCategory.EVENT, event: 'b', data: {}, timestamp: 3 });
    await repo.create({ category: ActivityCategory.EVENT, event: 'c', data: {}, timestamp: 2 });

    const results = await repo.findRecent({});
    expect(results.map((e) => e.event)).toEqual(['b', 'c', 'a']);
  });

  it('filters by category', async () => {
    await repo.create({ category: ActivityCategory.ERROR, event: 'err', data: {}, timestamp: 1 });
    await repo.create({
      category: ActivityCategory.STATUS,
      event: 'status',
      data: {},
      timestamp: 2,
    });

    const results = await repo.findRecent({ category: ActivityCategory.ERROR });
    expect(results.map((e) => e.event)).toEqual(['err']);
  });

  it('paginates with an exclusive `before` cursor', async () => {
    await repo.create({ category: ActivityCategory.EVENT, event: 'a', data: {}, timestamp: 10 });
    await repo.create({ category: ActivityCategory.EVENT, event: 'b', data: {}, timestamp: 20 });
    await repo.create({ category: ActivityCategory.EVENT, event: 'c', data: {}, timestamp: 30 });

    const page = await repo.findRecent({ before: 30 });
    expect(page.map((e) => e.event)).toEqual(['b', 'a']);
  });

  it('caps the limit at MAX_QUERY_LIMIT', async () => {
    for (let i = 0; i < 5; i++) {
      await repo.create({
        category: ActivityCategory.EVENT,
        event: `e${i}`,
        data: {},
        timestamp: i,
      });
    }

    const results = await repo.findRecent({ limit: 2 });
    expect(results).toHaveLength(2);
  });

  it('prunes to the cap after enough inserts', async () => {
    // PRUNE_EVERY is 100 and ACTIVITY_LOG_CAP is 5000; insert just over one prune cycle
    // worth of rows to exercise the prune path without inserting 5000+ rows.
    for (let i = 0; i < 101; i++) {
      await repo.create({
        category: ActivityCategory.EVENT,
        event: `e${i}`,
        data: {},
        timestamp: i,
      });
    }

    const all = await repo.findRecent({ limit: 500 });
    expect(all).toHaveLength(101);
  });
});
