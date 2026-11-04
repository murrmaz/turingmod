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
  const texts = (repo: IntervalMessageRepository) => repo.list().map((m) => m.message);
  const idOf = (repo: IntervalMessageRepository, text: string) =>
    repo.list().find((m) => m.message === text)?.id ?? 0;

  it('lists messages in the order they were added, enabled and never posted', () => {
    const repo = new IntervalMessageRepository(db);
    repo.add('Follow on socials');
    repo.add('Join the Discord');

    expect(repo.list()).toMatchObject([
      { message: 'Follow on socials', enabled: true, lastPostedAt: null },
      { message: 'Join the Discord', enabled: true, lastPostedAt: null },
    ]);
  });

  it('changes a message by id, keeping its place', () => {
    const repo = new IntervalMessageRepository(db);
    repo.add('a');
    repo.add('b');
    const a = idOf(repo, 'a');

    expect(repo.updateText(a, 'a2')).toBe(true);
    expect(repo.setEnabled(a, false)).toBe(true);
    expect(repo.markPosted(a, 1234)).toBe(true);

    expect(repo.list()).toMatchObject([
      { message: 'a2', enabled: false, lastPostedAt: 1234 },
      { message: 'b', enabled: true },
    ]);
  });

  it('reports a write to a message that is gone', () => {
    const repo = new IntervalMessageRepository(db);

    expect(repo.updateText(99, 'x')).toBe(false);
    expect(repo.setEnabled(99, false)).toBe(false);
    expect(repo.move(99, 'up')).toBe(false);
    expect(repo.markPosted(99, 1)).toBe(false);
    expect(repo.remove([99])).toBe(0);
  });

  it('moves a message past its neighbour, across gaps left by deleted ones', () => {
    const repo = new IntervalMessageRepository(db);
    for (const text of ['a', 'b', 'c']) repo.add(text);
    repo.remove([idOf(repo, 'b')]);

    expect(repo.move(idOf(repo, 'c'), 'up')).toBe(true);
    expect(texts(repo)).toEqual(['c', 'a']);

    expect(repo.move(idOf(repo, 'c'), 'down')).toBe(true);
    expect(texts(repo)).toEqual(['a', 'c']);
  });

  it('leaves a message already at the end it is moved towards', () => {
    const repo = new IntervalMessageRepository(db);
    repo.add('a');
    repo.add('b');

    expect(repo.move(idOf(repo, 'a'), 'up')).toBe(true);
    expect(repo.move(idOf(repo, 'b'), 'down')).toBe(true);

    expect(texts(repo)).toEqual(['a', 'b']);
  });

  it('adds after the last message, even once earlier ones have moved or gone', () => {
    const repo = new IntervalMessageRepository(db);
    repo.add('a');
    repo.add('b');
    repo.move(idOf(repo, 'b'), 'up');
    repo.remove([idOf(repo, 'a')]);
    repo.add('c');

    expect(texts(repo)).toEqual(['b', 'c']);
  });

  it('removes several messages, skipping ones already gone', () => {
    const repo = new IntervalMessageRepository(db);
    for (const text of ['a', 'b', 'c']) repo.add(text);

    expect(repo.remove([idOf(repo, 'a'), idOf(repo, 'c'), 99])).toBe(2);
    expect(texts(repo)).toEqual(['b']);
  });
});
