import 'reflect-metadata';
import { type ActivityLogEntry, StreamingPlatform } from '@turingmod/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '../../utils/Logger.js';
import type { DatabaseManager } from '../DatabaseManager.js';
import { type ActivityLogQuery, ActivityLogRepository } from './ActivityLogRepository.js';
import { createTestDatabase } from './testDatabase.js';

describe('ActivityLogRepository', () => {
  let db: DatabaseManager;
  let cleanup: () => Promise<void>;
  let repo: ActivityLogRepository;
  const warn = vi.fn();

  beforeEach(async () => {
    const test = await createTestDatabase();
    db = test.db;
    cleanup = test.cleanup;
    warn.mockClear();
    const logger = new Logger({ level: 'silent' });
    vi.spyOn(logger, 'child').mockReturnValue({ warn } as unknown as Logger);
    repo = new ActivityLogRepository(db, logger);
  });

  /** Each stores an entry under a fresh id, as ActivityForwarder does. */
  const addFollow = (timestamp: number, userDisplayName = 'someone') =>
    repo.create({
      id: crypto.randomUUID(),
      event: 'twitch.follow',
      data: { userId: '1', userName: 'a', userDisplayName, followDate: '2026-01-01T00:00:00.000Z' },
      timestamp,
    });
  const addRaid = (timestamp: number, fromBroadcasterDisplayName = 'raider') =>
    repo.create({
      id: crypto.randomUUID(),
      event: 'twitch.raid',
      data: {
        fromBroadcasterId: '2',
        fromBroadcasterName: 'b',
        fromBroadcasterDisplayName,
        viewers: 5,
      },
      timestamp,
    });
  const addCheer = (timestamp: number) =>
    repo.create({
      id: crypto.randomUUID(),
      event: 'twitch.cheer',
      data: { userId: null, userName: null, userDisplayName: null, bits: 5, message: '' },
      timestamp,
    });
  const commandEntry = (id: string, message: string, timestamp: number): ActivityLogEntry => ({
    id,
    event: 'command.executed',
    data: {
      success: true,
      command: 'title',
      username: 'ana',
      userId: '1',
      platform: StreamingPlatform.TWITCH,
      args: [],
      message,
      isSimulation: false,
    },
    timestamp,
  });
  const addCommand = (timestamp: number, message = '') =>
    repo.create(commandEntry(crypto.randomUUID(), message, timestamp));
  /** A row as an earlier version of TuringMod might have left it. */
  const addRow = (id: string, event: string, data: string, timestamp = 1) =>
    db.run('INSERT INTO activity_log (id, event, data, timestamp) VALUES (?, ?, ?, ?)', [
      id,
      event,
      data,
      timestamp,
    ]);

  afterEach(async () => {
    await cleanup();
  });

  it('creates an entry and round-trips the JSON data payload', () => {
    const entry = commandEntry('broadcast-id', 'Title set', 1000);
    repo.create(entry);

    // Stored under the id it was broadcast with, not a new one.
    const [found] = repo.findRecent({});
    expect(found).toEqual(entry);
  });

  it('returns entries most-recent-first', () => {
    addFollow(1);
    addRaid(3);
    addCheer(2);

    const results = repo.findRecent({});
    expect(results.map((e) => e.event)).toEqual(['twitch.raid', 'twitch.cheer', 'twitch.follow']);
  });

  it('paginates with an exclusive `before` cursor', () => {
    addFollow(10);
    addRaid(20);
    addCheer(30);

    const page = repo.findRecent({ before: 30 });
    expect(page.map((e) => e.event)).toEqual(['twitch.raid', 'twitch.follow']);
  });

  it('caps the limit at MAX_QUERY_LIMIT', () => {
    for (let i = 0; i < 5; i++) {
      addFollow(i);
    }

    const results = repo.findRecent({ limit: 2 });
    expect(results).toHaveLength(2);
  });

  it('prunes to the cap after enough inserts', () => {
    // PRUNE_EVERY is 100 and ACTIVITY_LOG_CAP is 5000; insert just over one prune cycle
    // worth of rows to exercise the prune path without inserting 5000+ rows.
    for (let i = 0; i < 101; i++) {
      addFollow(i);
    }

    const all = repo.findRecent({ limit: 500 });
    expect(all).toHaveLength(101);
  });

  it('leaves out and logs a stored event the log does not record', () => {
    addFollow(2);
    addRow('retired-row', 'twitch.stream.online', '{}');

    expect(repo.findRecent({}).map((e) => e.event)).toEqual(['twitch.follow']);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('does not fit'),
      expect.objectContaining({ id: 'retired-row' })
    );
  });

  it('leaves out and logs a stored row whose payload is missing a field', () => {
    addFollow(2);
    addRow('old-row', 'twitch.raid', '{"viewers":5}');

    expect(repo.findRecent({}).map((e) => e.event)).toEqual(['twitch.follow']);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('does not fit'),
      expect.objectContaining({ id: 'old-row', problem: expect.stringContaining('data') })
    );
  });

  it('leaves out and logs a stored row whose data is not JSON', () => {
    addFollow(2);
    addRow('broken-row', 'twitch.follow', '{not json');

    expect(repo.findRecent({}).map((e) => e.event)).toEqual(['twitch.follow']);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('unreadable'),
      expect.objectContaining({ id: 'broken-row' })
    );
  });

  it('reads a stored row with a field its payload no longer has, without that field', () => {
    addRow(
      'old-row',
      'platform.liveState',
      '{"platform":"twitch","live":false,"startedAt":null,"cause":"reported"}'
    );

    expect(repo.findRecent({})[0]?.data).toEqual({
      platform: StreamingPlatform.TWITCH,
      live: false,
      startedAt: null,
    });
    expect(warn).not.toHaveBeenCalled();
  });

  describe('findPage', () => {
    const page = (query: Partial<ActivityLogQuery> = {}) =>
      repo.findPage({ page: 0, pageSize: 50, ...query });
    const events = (query: Partial<ActivityLogQuery> = {}) =>
      page(query).entries.map((entry) => entry.event);
    const followers = (entries: ActivityLogEntry[]) =>
      entries.map((entry) => (entry.event === 'twitch.follow' ? entry.data.userDisplayName : null));

    it('pages through the log newest first, counting every match', () => {
      for (let i = 1; i <= 5; i++) {
        addFollow(i, `viewer-${i}`);
      }

      const second = page({ page: 1, pageSize: 2 });

      expect(followers(second.entries)).toEqual(['viewer-3', 'viewer-2']);
      expect(second.total).toBe(5);
      expect(page({ page: 3, pageSize: 2 })).toEqual({ entries: [], total: 5 });
    });

    it('keeps entries made in the same millisecond in one order across pages', () => {
      for (const n of [1, 2, 3]) {
        addFollow(100, `viewer-${n}`);
      }

      const pages = [0, 1, 2].flatMap((index) =>
        followers(page({ page: index, pageSize: 1 }).entries)
      );

      expect(pages).toEqual(['viewer-3', 'viewer-2', 'viewer-1']);
    });

    it('reads only the given events', () => {
      addFollow(1);
      addRaid(2);
      addCommand(3);

      expect(events({ events: ['twitch.follow', 'twitch.raid'] })).toEqual([
        'twitch.raid',
        'twitch.follow',
      ]);
      expect(page({ events: ['twitch.follow'] }).total).toBe(1);
      expect(events({ events: [] })).toEqual([]);
    });

    it('searches the event name and the payload, ignoring case', () => {
      addRaid(1, 'CoolRaider');
      addFollow(2, 'someone');

      expect(events({ search: 'coolraider' })).toEqual(['twitch.raid']);
      expect(events({ search: ' follow ' })).toEqual(['twitch.follow']);
    });

    it('takes % and _ in a search literally', () => {
      addCommand(1, '100% done');
      addCommand(2, '1000 done');
      addCommand(3, 'a_b');
      addCommand(4, 'axb');

      expect(page({ search: '0%' }).total).toBe(1);
      expect(page({ search: 'a_b' }).total).toBe(1);
    });

    it('reads only entries made since a time, that time included', () => {
      addFollow(10);
      addRaid(20);
      addCheer(30);

      expect(events({ since: 20 })).toEqual(['twitch.cheer', 'twitch.raid']);
    });

    it('applies every condition at once', () => {
      addFollow(10, 'ana');
      addFollow(30, 'ana');
      addRaid(40, 'ana');
      addFollow(50, 'bo');

      const found = page({ events: ['twitch.follow'], search: 'ana', since: 20 });

      expect(found.total).toBe(1);
      expect(found.entries[0]?.timestamp).toBe(30);
    });

    it('leaves out a stored entry that no longer fits, still counting it', () => {
      addFollow(2);
      addRow('retired-row', 'twitch.stream.online', '{}');

      expect(page().entries.map((entry) => entry.event)).toEqual(['twitch.follow']);
      expect(page().total).toBe(2);
    });
  });
});
