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
  it('stores words lowercased, and renews the ban when a word is banned again in any case', () => {
    const repo = new BannedWordRepository(db);

    repo.ban('Cheese', 'viewer', 1000);
    repo.ban('CHEESE', 'someone else', 2000);

    expect(repo.list()).toEqual([{ word: 'cheese', bannedBy: 'someone else', bannedAt: 2000 }]);
  });

  it('lists oldest first and removes case-insensitively', () => {
    const repo = new BannedWordRepository(db);
    repo.ban('newer', null, 2000);
    repo.ban('older', null, 1000);

    expect(repo.list().map((w) => w.word)).toEqual(['older', 'newer']);
    expect(repo.remove('OLDER')).toBe(true);
    expect(repo.remove('older')).toBe(false);
    expect(repo.list().map((w) => w.word)).toEqual(['newer']);
  });
});

describe('CounterRepository', () => {
  it('reads an unset counter as 0 and increments from there', () => {
    const repo = new CounterRepository(db);

    expect(repo.get('deaths')).toBe(0);
    expect(repo.increment('deaths')).toBe(1);
    expect(repo.increment('deaths', 2)).toBe(3);
  });

  it('sets a counter outright, including back to zero', () => {
    const repo = new CounterRepository(db);
    repo.set('deaths', 41);
    expect(repo.increment('deaths')).toBe(42);

    repo.set('deaths', 0);
    expect(repo.get('deaths')).toBe(0);
  });
});

describe('IntervalMessageRepository', () => {
  it('keeps the rotation in the order messages were added', () => {
    const repo = new IntervalMessageRepository(db);
    repo.add('socials', 'Follow on socials', 'mod');
    repo.add('discord', 'Join the Discord', null);

    expect(repo.add('socials', 'duplicate', null)).toBe(false);
    expect(repo.update('socials', 'Follow everywhere')).toBe(true);
    expect(repo.list()).toEqual([
      { name: 'socials', message: 'Follow everywhere', createdBy: 'mod' },
      { name: 'discord', message: 'Join the Discord', createdBy: null },
    ]);

    expect(repo.remove('socials')).toBe(true);
    expect(repo.list().map((m) => m.name)).toEqual(['discord']);
  });
});
