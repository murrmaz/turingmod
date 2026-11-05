import { BAN_DURATION_MS } from '@turingmod/shared';
import { describe, expect, it } from 'vitest';
import { banCutoff } from './bannedWords.js';

describe('banCutoff', () => {
  it('keeps a ban in force for thirty days', () => {
    expect(BAN_DURATION_MS).toBe(30 * 24 * 60 * 60 * 1000);
    expect(banCutoff(BAN_DURATION_MS + 5)).toBe(5);
  });
});
