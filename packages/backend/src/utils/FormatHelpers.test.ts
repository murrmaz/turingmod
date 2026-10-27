import { describe, expect, it } from 'vitest';
import { formatCountdown, formatDuration, formatElapsed } from './FormatHelpers.js';

describe('formatDuration', () => {
  it.each([
    [45 * 60_000, '45m'],
    [60 * 60_000, '1h 0m'],
    [(2 * 60 + 59) * 60_000 + 50_000, '2h 59m'],
    [59_000, '0m'],
    [-5, '0m'],
  ])('formats %d ms as %s', (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected);
  });
});

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

describe('formatElapsed', () => {
  const Second = 1000;
  const Minute = 60 * Second;
  const Hour = 60 * Minute;
  const Day = 24 * Hour;

  it('names up to the three largest non-empty units', () => {
    expect(formatElapsed(2 * 365 * Day + 3 * 30 * Day + 4 * Day + 5 * Hour)).toBe(
      '2 years, 3 months and 4 days'
    );
    expect(formatElapsed(Hour + 5 * Minute)).toBe('1 hour and 5 minutes');
    expect(formatElapsed(45 * Second)).toBe('45 seconds');
  });

  it('skips empty units and handles nothing at all', () => {
    expect(formatElapsed(Day + 30 * Second)).toBe('1 day and 30 seconds');
    expect(formatElapsed(0)).toBe('0 seconds');
    expect(formatElapsed(-5)).toBe('0 seconds');
  });
});
