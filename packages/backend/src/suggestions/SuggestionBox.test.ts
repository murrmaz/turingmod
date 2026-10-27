import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseManager } from '../database/DatabaseManager.js';
import { SuggestionRepository } from '../database/repositories/SuggestionRepository.js';
import { createTestDatabase } from '../database/repositories/testDatabase.js';
import { SuggestionBox } from './SuggestionBox.js';

let db: DatabaseManager;
let cleanup: () => Promise<void>;
let box: SuggestionBox;

beforeEach(async () => {
  ({ db, cleanup } = await createTestDatabase());
  box = new SuggestionBox(new SuggestionRepository(db));
});

afterEach(async () => {
  await cleanup();
});

describe('SuggestionBox', () => {
  it('lists every suggestion newest first', () => {
    box.add('a quote command', 'viewer1');
    box.add('more bonk', null);

    expect(box.list()).toMatchObject([
      { suggestion: 'more bonk', suggestedBy: null },
      { suggestion: 'a quote command', suggestedBy: 'viewer1' },
    ]);
  });

  it('deletes only the given ids, skipping ones already gone', () => {
    box.add('keep', 'a');
    box.add('troll 1', 'b');
    box.add('troll 2', 'b');
    const [troll2, troll1] = box.list();

    box.delete([troll1?.id ?? 0, troll2?.id ?? 0, 999]);

    expect(box.list().map((s) => s.suggestion)).toEqual(['keep']);
  });

  it('tells listeners when a suggestion is added or deleted, and not when nothing was', () => {
    const listener = vi.fn();
    const unsubscribe = box.onChange(listener);

    box.add('more bonk', 'viewer1');
    expect(listener).toHaveBeenCalledTimes(1);
    box.delete([box.list()[0]?.id ?? 0]);
    expect(listener).toHaveBeenCalledTimes(2);
    box.delete([999]);
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    box.add('ignored', null);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
