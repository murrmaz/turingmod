import 'reflect-metadata';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Platform } from '@turingmod/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Logger } from '../../utils/Logger.js';
import { DatabaseManager } from '../DatabaseManager.js';
import { initialSchema } from '../migrations/001_initial_schema.js';
import { CommandHistoryRepository } from './CommandHistoryRepository.js';

describe('CommandHistoryRepository', () => {
  let dir: string;
  let db: DatabaseManager;
  let repo: CommandHistoryRepository;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'turingmod-cmdhistory-repo-test-'));
    db = new DatabaseManager(join(dir, 'test.sqlite'), new Logger({ level: 'silent' }));
    await db.initialize();
    initialSchema.up(db);
    repo = new CommandHistoryRepository(db);
  });

  afterEach(async () => {
    db.close();
    await rm(dir, { recursive: true, force: true });
  });

  function ensureUser(id: string): void {
    db.run(
      `INSERT OR IGNORE INTO users (
        id, platform, platform_user_id, username, permission_level, created_at, updated_at
      ) VALUES (?, 'twitch', ?, ?, 'viewer', ?, ?)`,
      [id, id, id, Date.now(), Date.now()]
    );
  }

  function entry(overrides: Partial<Parameters<CommandHistoryRepository['create']>[0]> = {}) {
    const userId = overrides.userId ?? 'user-1';
    ensureUser(userId);
    return {
      commandName: '!title',
      userId,
      platform: Platform.TWITCH,
      args: ['new title'],
      result: { success: true, message: 'ok' },
      isSimulation: false,
      executedAt: Date.now(),
      ...overrides,
    };
  }

  it('creates an entry and round-trips args/result JSON and the simulation flag', async () => {
    const created = await repo.create(entry({ isSimulation: true }));
    expect(created.id).toBeTruthy();
    expect(created.args).toEqual(['new title']);
    expect(created.result).toEqual({ success: true, message: 'ok' });
    expect(created.isSimulation).toBe(true);

    const [found] = await repo.findRecent();
    expect(found).toEqual(created);
  });

  it('finds entries by user id, most-recent-first', async () => {
    await repo.create(entry({ userId: 'user-1', executedAt: 1 }));
    await repo.create(entry({ userId: 'user-2', executedAt: 2 }));
    await repo.create(entry({ userId: 'user-1', executedAt: 3 }));

    const results = await repo.findByUserId('user-1');
    expect(results.map((r) => r.executedAt)).toEqual([3, 1]);
  });

  it('finds entries by command name, most-recent-first', async () => {
    await repo.create(entry({ commandName: '!title', executedAt: 1 }));
    await repo.create(entry({ commandName: '!game', executedAt: 2 }));
    await repo.create(entry({ commandName: '!title', executedAt: 3 }));

    const results = await repo.findByCommandName('!title');
    expect(results.map((r) => r.executedAt)).toEqual([3, 1]);
  });

  it('respects the limit parameter', async () => {
    for (let i = 0; i < 5; i++) {
      await repo.create(entry({ userId: 'user-1', executedAt: i }));
    }

    const results = await repo.findByUserId('user-1', 2);
    expect(results).toHaveLength(2);
  });

  it('finds recent entries including simulations by default', async () => {
    await repo.create(entry({ isSimulation: false, executedAt: 1 }));
    await repo.create(entry({ isSimulation: true, executedAt: 2 }));

    const results = await repo.findRecent();
    expect(results).toHaveLength(2);
  });

  it('excludes simulations when includeSimulations is false', async () => {
    await repo.create(entry({ isSimulation: false, executedAt: 1 }));
    await repo.create(entry({ isSimulation: true, executedAt: 2 }));

    const results = await repo.findRecent(50, false);
    expect(results).toHaveLength(1);
    expect(results[0]?.isSimulation).toBe(false);
  });

  it('deletes entries older than a timestamp and returns the count removed', async () => {
    await repo.create(entry({ executedAt: 1 }));
    await repo.create(entry({ executedAt: 2 }));
    await repo.create(entry({ executedAt: 10 }));

    const removed = await repo.deleteOlderThan(5);
    expect(removed).toBe(2);

    const remaining = await repo.findRecent();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.executedAt).toBe(10);
  });
});
