import { describe, expect, it } from 'vitest';
import { formatCountdown } from './FormatHelpers.js';

describe('formatCountdown', () => {
  it.each([
    [300_000, '5m'],
    [90_000, '1m 30s'],
    [59_600, '1m'],
    [45_000, '45s'],
    [0, '0s'],
    [-5_000, '0s'],
  ])('formats %d ms as %s', (ms, expected) => {
    expect(formatCountdown(ms)).toBe(expected);
  });
});
