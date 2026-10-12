import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseManager } from '../DatabaseManager.js';
import { BannedWordRepository } from './BannedWordRepository.js';
import { CounterRepository } from './CounterRepository.js';
import { IntervalMessageRepository } from './IntervalMessageRepository.js';
import { createTestDatabase } from './testDatabase.js';

let db: DatabaseManager;
let cleanup: () => Promise<void>;

beforeEach(async () => {
  ({ db, cleanup } = await createTestDatabase());
});

afterEach(async () => {
  await cleanup();
});

describe('BannedWordRepository', () => {
  it('stores words lowercased and refuses a duplicate in any case', async () => {
    const repo = new BannedWordRepository(db);

    expect(await repo.add('Cheese', 'viewer', 1000)).toBe(true);
    expect(await repo.add('CHEESE', 'someone else')).toBe(false);

    expect(await repo.list()).toEqual([{ word: 'cheese', bannedBy: 'viewer', bannedAt: 1000 }]);
  });

  it('lists oldest first and removes case-insensitively', async () => {
    const repo = new BannedWordRepository(db);
    await repo.add('newer', null, 2000);
    await repo.add('older', null, 1000);

    expect((await repo.list()).map((w) => w.word)).toEqual(['older', 'newer']);
    expect(await repo.remove('OLDER')).toBe(true);
    expect(await repo.remove('older')).toBe(false);
    expect((await repo.list()).map((w) => w.word)).toEqual(['newer']);
  });
});

describe('CounterRepository', () => {
  it('reads an unset counter as 0 and increments from there', async () => {
    const repo = new CounterRepository(db);

    expect(await repo.has('deaths')).toBe(false);
    expect(await repo.get('deaths')).toBe(0);
    expect(await repo.increment('deaths')).toBe(1);
    expect(await repo.increment('deaths', 2)).toBe(3);
    expect(await repo.has('deaths')).toBe(true);
  });

  it('sets a counter outright, including back to zero', async () => {
    const repo = new CounterRepository(db);
    await repo.set('deaths', 41);
    expect(await repo.increment('deaths')).toBe(42);

    await repo.set('deaths', 0);
    expect(await repo.get('deaths')).toBe(0);
    expect(await repo.has('deaths')).toBe(true);
  });
});

describe('IntervalMessageRepository', () => {
  it('keeps the rotation in the order messages were added', async () => {
    const repo = new IntervalMessageRepository(db);
    await repo.add('socials', 'Follow on socials', 'mod');
    await repo.add('discord', 'Join the Discord', null);

    expect(await repo.add('socials', 'duplicate', null)).toBe(false);
    expect(await repo.update('socials', 'Follow everywhere')).toBe(true);
    expect(await repo.list()).toEqual([
      { name: 'socials', message: 'Follow everywhere', createdBy: 'mod' },
      { name: 'discord', message: 'Join the Discord', createdBy: null },
    ]);

    expect(await repo.remove('socials')).toBe(true);
    expect((await repo.list()).map((m) => m.name)).toEqual(['discord']);
  });
});
