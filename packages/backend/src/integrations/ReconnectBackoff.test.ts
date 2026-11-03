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

  it('counts attempts until the delays start over', () => {
    delays(3);
    expect(backoff.attempts).toBe(3);

    backoff.connected();
    backoff.disconnected();
    expect(backoff.attempts).toBe(3);

    backoff.connected();
    vi.advanceTimersByTime(30_000);
    backoff.disconnected();
    expect(backoff.attempts).toBe(0);

    delays(2);
    backoff.reset();
    expect(backoff.attempts).toBe(0);
  });

  describe('generations', () => {
    it('a start leaves attempts from before it out of date', () => {
      const first = backoff.begin();
      expect(backoff.isCurrent(first)).toBe(true);

      const second = backoff.begin();

      expect(backoff.isCurrent(first)).toBe(false);
      expect(backoff.isCurrent(second)).toBe(true);
    });

    it('a start begins again at the shortest delay', () => {
      backoff.begin();
      delays(3);

      backoff.begin();

      expect(delays(1)).toEqual([2_000]);
    });

    it('a stop leaves the attempt in progress out of date and drops the one pending', async () => {
      const generation = backoff.begin();
      const connect = vi.fn(() => Promise.resolve());
      backoff.retry(connect);

      backoff.end();
      await vi.advanceTimersByTimeAsync(60_000);

      expect(backoff.isCurrent(generation)).toBe(false);
      expect(connect).not.toHaveBeenCalled();
    });

    it('a retry runs in the current generation and swallows its rejection', async () => {
      const unhandled = vi.fn();
      process.on('unhandledRejection', unhandled);
      try {
        const generation = backoff.begin();
        // Not a vi.fn(): it handles what it returns, which would hide an unhandled rejection.
        const attempts: number[] = [];
        const connect = (attempt: number) => {
          attempts.push(attempt);
          return Promise.reject(new Error('already reported'));
        };

        expect(backoff.retry(connect)).toBe(2_000);
        await vi.advanceTimersByTimeAsync(2_000);
        expect(attempts).toEqual([generation]);

        // Give Node a turn to report an unhandled rejection, if there were one.
        vi.useRealTimers();
        await new Promise((resolve) => setImmediate(resolve));
        expect(unhandled).not.toHaveBeenCalled();
      } finally {
        process.off('unhandledRejection', unhandled);
      }
    });
  });
});
