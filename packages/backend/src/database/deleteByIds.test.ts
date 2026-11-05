import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseManager } from './DatabaseManager.js';
import { deleteByIds } from './deleteByIds.js';
import { SuggestionRepository } from './repositories/SuggestionRepository.js';
import { createTestDatabase } from './repositories/testDatabase.js';

describe('deleteByIds', () => {
  let db: DatabaseManager;
  let cleanup: () => Promise<void>;
  let suggestions: SuggestionRepository;

  beforeEach(async () => {
    ({ db, cleanup } = await createTestDatabase());
    suggestions = new SuggestionRepository(db);
    for (const text of ['one', 'two', 'three']) {
      suggestions.add(text, 'viewer');
    }
  });

  afterEach(() => cleanup());

  it('deletes the rows with those ids, skipping ones already gone, and counts what went', () => {
    const [three, two] = suggestions.list().map(({ id }) => id);

    expect(deleteByIds(db, 'suggestions', [three ?? 0, two ?? 0, 999])).toBe(2);
    expect(suggestions.list().map(({ suggestion }) => suggestion)).toEqual(['one']);
  });

  it('deletes nothing for no ids, which SQL has no way to write', () => {
    expect(deleteByIds(db, 'suggestions', [])).toBe(0);
    expect(suggestions.list()).toHaveLength(3);
  });
});
