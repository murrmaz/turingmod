import { describe, expect, it } from 'vitest';
import { BAN_DURATION_MS, banCutoff, normalizeBannedWord, wordsIn } from './bannedWords.js';

describe('banned word matching', () => {
  it('splits a message into lowercased words without punctuation', () => {
    expect(wordsIn('Say "CHEESE!" now,  ok?')).toEqual(['say', 'cheese', 'now', 'ok']);
  });

  it('accepts exactly one word to ban', () => {
    expect(normalizeBannedWord('  Cheese! ')).toBe('cheese');
    expect(normalizeBannedWord('two words')).toBeNull();
    expect(normalizeBannedWord('!!!')).toBeNull();
    expect(normalizeBannedWord('')).toBeNull();
  });

  it('keeps a ban in force for thirty days', () => {
    expect(BAN_DURATION_MS).toBe(30 * 24 * 60 * 60 * 1000);
    expect(banCutoff(BAN_DURATION_MS + 5)).toBe(5);
  });
});
