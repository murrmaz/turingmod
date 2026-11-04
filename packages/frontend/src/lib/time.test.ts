import { describe, expect, it } from 'vitest';
import { dayOf, formatDateTime, formatDay, formatUptime } from './time';

describe('formatUptime', () => {
  it('formats hours, minutes and seconds', () => {
    expect(formatUptime(((2 * 60 + 14) * 60 + 37) * 1000)).toBe('2:14:37');
  });
});

describe('dayOf', () => {
  it('is the local date, the same all day and different the next', () => {
    expect(dayOf(new Date(2026, 0, 5, 0, 0).getTime())).toBe('2026-01-05');
    expect(dayOf(new Date(2026, 0, 5, 23, 59).getTime())).toBe('2026-01-05');
    expect(dayOf(new Date(2026, 0, 6, 0, 0).getTime())).toBe('2026-01-06');
  });
});

describe('formatDateTime', () => {
  it('is the local date and time', () => {
    expect(formatDateTime(new Date(2026, 0, 5, 14, 3, 9).getTime())).toBe('2026-01-05 14:03:09');
  });
});

describe('formatDay', () => {
  const now = new Date(2026, 9, 24, 15, 0).getTime();
  const at = (day: number, hour: number) => new Date(2026, 9, day, hour).getTime();

  it('names today and yesterday, and dates the rest', () => {
    expect(formatDay(at(24, 9), now)).toMatch(/^Today · /);
    expect(formatDay(at(23, 23), now)).toMatch(/^Yesterday · /);
    expect(formatDay(at(22, 9), now)).not.toMatch(/Today|Yesterday/);
    expect(formatDay(new Date(2025, 2, 3).getTime(), now)).toContain('2025');
  });
});
