import { describe, expect, it } from 'vitest';
import { reconnectDelay } from './connection';

describe('reconnectDelay', () => {
  it('waits a second, doubling with each failure, up to 30 seconds', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(reconnectDelay)).toEqual([
      1000, 2000, 4000, 8000, 16_000, 30_000, 30_000,
    ]);
  });
});
