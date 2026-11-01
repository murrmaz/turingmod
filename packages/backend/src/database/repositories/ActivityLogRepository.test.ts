import 'reflect-metadata';
import type { ActivityLogEntry } from '@turingmod/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseManager } from '../DatabaseManager.js';
import { type ActivityLogQuery, ActivityLogRepository } from './ActivityLogRepository.js';
import { createTestDatabase } from './testDatabase.js';

describe('ActivityLogRepository', () => {
  let db: DatabaseManager;
  let cleanup: () => Promise<void>;
  let repo: ActivityLogRepository;

  beforeEach(async () => {
    const test = await createTestDatabase();
    db = test.db;
    cleanup = test.cleanup;
    repo = new ActivityLogRepository(db);
  });

  /** Store an entry under a fresh id, as ActivityForwarder does. */
  const add = (entry: Omit<ActivityLogEntry, 'id'>) =>
    repo.create({ id: crypto.randomUUID(), ...entry });

  afterEach(async () => {
    await cleanup();
  });

  it('creates an entry and round-trips the JSON data payload', () => {
    const entry: ActivityLogEntry = {
      id: 'broadcast-id',
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
    add({ event: 'twitch.follow', data: {}, timestamp: 1 });
    add({ event: 'twitch.raid', data: {}, timestamp: 3 });
    add({ event: 'twitch.cheer', data: {}, timestamp: 2 });

    const results = repo.findRecent({});
    expect(results.map((e) => e.event)).toEqual(['twitch.raid', 'twitch.cheer', 'twitch.follow']);
  });

  it('paginates with an exclusive `before` cursor', () => {
    add({ event: 'twitch.follow', data: {}, timestamp: 10 });
    add({ event: 'twitch.raid', data: {}, timestamp: 20 });
    add({ event: 'twitch.cheer', data: {}, timestamp: 30 });

    const page = repo.findRecent({ before: 30 });
    expect(page.map((e) => e.event)).toEqual(['twitch.raid', 'twitch.follow']);
  });

  it('caps the limit at MAX_QUERY_LIMIT', () => {
    for (let i = 0; i < 5; i++) {
      add({
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
        event: 'twitch.follow',
        data: {},
        timestamp: i,
      });
    }

    const all = repo.findRecent({ limit: 500 });
    expect(all).toHaveLength(101);
  });

  it('fails the read on a stored event the log does not record', () => {
    db.run('INSERT INTO activity_log (id, event, data, timestamp) VALUES (?, ?, ?, ?)', [
      'retired-row',
      'twitch.stream.online',
      '{}',
      1,
    ]);

    expect(() => repo.findRecent({})).toThrow(/retired-row is invalid[\s\S]*event/);
  });

  it('fails the read on a stored row whose data is not JSON', () => {
    db.run('INSERT INTO activity_log (id, event, data, timestamp) VALUES (?, ?, ?, ?)', [
      'broken-row',
      'twitch.follow',
      '{not json',
      1,
    ]);

    expect(() => repo.findRecent({})).toThrow(/broken-row has unreadable data/);
  });

  describe('findPage', () => {
    const page = (query: Partial<ActivityLogQuery> = {}) =>
      repo.findPage({ page: 0, pageSize: 50, ...query });
    const events = (query: Partial<ActivityLogQuery> = {}) =>
      page(query).entries.map((entry) => entry.event);

    it('pages through the log newest first, counting every match', () => {
      for (let i = 1; i <= 5; i++) {
        add({ event: 'twitch.follow', data: { n: i }, timestamp: i });
      }

      const second = page({ page: 1, pageSize: 2 });

      expect(second.entries.map((entry) => entry.data.n)).toEqual([3, 2]);
      expect(second.total).toBe(5);
      expect(page({ page: 3, pageSize: 2 })).toEqual({ entries: [], total: 5 });
    });

    it('keeps entries made in the same millisecond in one order across pages', () => {
      for (const n of [1, 2, 3]) {
        add({ event: 'twitch.follow', data: { n }, timestamp: 100 });
      }

      const pages = [0, 1, 2].flatMap((index) =>
        page({ page: index, pageSize: 1 }).entries.map((entry) => entry.data.n)
      );

      expect(pages).toEqual([3, 2, 1]);
    });

    it('reads only the given events', () => {
      add({ event: 'twitch.follow', data: {}, timestamp: 1 });
      add({ event: 'twitch.raid', data: {}, timestamp: 2 });
      add({ event: 'command.executed', data: {}, timestamp: 3 });

      expect(events({ events: ['twitch.follow', 'twitch.raid'] })).toEqual([
        'twitch.raid',
        'twitch.follow',
      ]);
      expect(page({ events: ['twitch.follow'] }).total).toBe(1);
      expect(events({ events: [] })).toEqual([]);
    });

    it('searches the event name and the payload, ignoring case', () => {
      add({
        event: 'twitch.raid',
        data: { fromBroadcasterDisplayName: 'CoolRaider' },
        timestamp: 1,
      });
      add({ event: 'twitch.follow', data: { userDisplayName: 'someone' }, timestamp: 2 });

      expect(events({ search: 'coolraider' })).toEqual(['twitch.raid']);
      expect(events({ search: ' follow ' })).toEqual(['twitch.follow']);
    });

    it('takes % and _ in a search literally', () => {
      add({ event: 'command.executed', data: { message: '100% done' }, timestamp: 1 });
      add({ event: 'command.executed', data: { message: '1000 done' }, timestamp: 2 });
      add({ event: 'command.executed', data: { message: 'a_b' }, timestamp: 3 });
      add({ event: 'command.executed', data: { message: 'axb' }, timestamp: 4 });

      expect(page({ search: '0%' }).total).toBe(1);
      expect(page({ search: 'a_b' }).total).toBe(1);
    });

    it('reads only entries made since a time, that time included', () => {
      add({ event: 'twitch.follow', data: {}, timestamp: 10 });
      add({ event: 'twitch.raid', data: {}, timestamp: 20 });
      add({ event: 'twitch.cheer', data: {}, timestamp: 30 });

      expect(events({ since: 20 })).toEqual(['twitch.cheer', 'twitch.raid']);
    });

    it('applies every condition at once', () => {
      add({ event: 'twitch.follow', data: { userDisplayName: 'ana' }, timestamp: 10 });
      add({ event: 'twitch.follow', data: { userDisplayName: 'ana' }, timestamp: 30 });
      add({ event: 'twitch.raid', data: { fromBroadcasterDisplayName: 'ana' }, timestamp: 40 });
      add({ event: 'twitch.follow', data: { userDisplayName: 'bo' }, timestamp: 50 });

      const found = page({ events: ['twitch.follow'], search: 'ana', since: 20 });

      expect(found.total).toBe(1);
      expect(found.entries[0]?.timestamp).toBe(30);
    });

    it('fails the read on a stored entry that no longer fits, rather than leaving it out', () => {
      db.run('INSERT INTO activity_log (id, event, data, timestamp) VALUES (?, ?, ?, ?)', [
        'retired-row',
        'twitch.stream.online',
        '{}',
        1,
      ]);

      expect(() => page()).toThrow(/retired-row is invalid/);
    });
  });
});
