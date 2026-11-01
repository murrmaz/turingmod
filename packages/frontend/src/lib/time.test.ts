import { describe, expect, it } from 'vitest';
import { formatDay, formatUptime } from './time';

describe('formatUptime', () => {
  it('formats hours, minutes and seconds', () => {
    expect(formatUptime(((2 * 60 + 14) * 60 + 37) * 1000)).toBe('2:14:37');
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
