import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReconnectBackoff } from './ReconnectBackoff.js';

describe('ReconnectBackoff', () => {
  let backoff: ReconnectBackoff;

  beforeEach(() => {
    vi.useFakeTimers();
    backoff = new ReconnectBackoff();
  });

  afterEach(() => {
    backoff.cancel();
    vi.useRealTimers();
  });

  const delays = (count: number) => Array.from({ length: count }, () => backoff.schedule(() => {}));

  it('doubles the delay up to 30s', () => {
    expect(delays(6)).toEqual([2_000, 4_000, 8_000, 16_000, 30_000, 30_000]);
  });

  it('runs the attempt after the delay, and only the latest one scheduled', () => {
    const first = vi.fn();
    const second = vi.fn();
    backoff.schedule(first);
    backoff.schedule(second);

    vi.advanceTimersByTime(4_000);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });

  it('carries on backing off after a connection that dropped quickly', () => {
    delays(2);
    backoff.connected();
    vi.advanceTimersByTime(29_999);
    backoff.disconnected();

    expect(backoff.schedule(() => {})).toBe(8_000);
  });

  it('starts over after a connection that lasted 30s', () => {
    delays(2);
    backoff.connected();
    vi.advanceTimersByTime(30_000);
    backoff.disconnected();

    expect(backoff.schedule(() => {})).toBe(2_000);
  });

  it('starts over, with nothing pending, when reset', () => {
    const attempt = vi.fn();
    delays(3);
    backoff.schedule(attempt);
    backoff.reset();

    vi.advanceTimersByTime(60_000);
    expect(attempt).not.toHaveBeenCalled();
    expect(backoff.schedule(() => {})).toBe(2_000);
  });
});
