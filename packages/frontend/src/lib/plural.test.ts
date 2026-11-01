import { describe, expect, it } from 'vitest';
import { plural } from './plural';

describe('plural', () => {
  it('names one of something in the singular, and any other count in the plural', () => {
    expect(plural(1, 'new event')).toBe('1 new event');
    expect(plural(0, 'event')).toBe('0 events');
    expect(plural(2, 'event')).toBe('2 events');
  });

  it('writes a large count as the streamer would read it', () => {
    expect(plural(1204, 'row')).toBe(`${(1204).toLocaleString()} rows`);
  });
});
