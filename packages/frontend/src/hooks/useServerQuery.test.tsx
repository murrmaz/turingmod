import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrpcClient } from '@/context/trpc-context';
import { ConnectionError } from '@/services/connection';
import { type Deferred, deferred } from '@/testing/fakeTrpc';
import { switchableConnection } from '@/testing/render-console';
import { useServerQuery } from './useServerQuery';

const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

interface Read {
  client: TrpcClient;
  input: string;
  signal: AbortSignal;
  answer: Deferred<string>;
}

/** Every read made, each waiting for the test to answer it. */
function setup(connected = true) {
  const reads: Read[] = [];
  const read = (client: TrpcClient, input: string, { signal }: { signal: AbortSignal }) => {
    const answer = deferred<string>();
    reads.push({ client, input, signal, answer });
    return answer.promise;
  };
  const connection = switchableConnection({}, connected ? 'connected' : 'reconnecting');
  return { reads, read, ...connection };
}

async function answer(read: Read | undefined, value: string | Error) {
  await act(async () => {
    if (value instanceof Error) {
      read?.answer.reject(value);
    } else {
      read?.answer.resolve(value);
    }
    await read?.answer.promise.catch(() => undefined);
  });
}

describe('useServerQuery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is loading the initial data until the first reply', async () => {
    const { reads, read, wrapper } = setup();
    const { result } = renderHook(() => useServerQuery(read, { input: 'a', initial: 'none' }), {
      wrapper,
    });
    expect(result.current).toMatchObject({ data: 'none', loading: true, error: null });

    await answer(reads[0], 'first');

    expect(result.current).toMatchObject({ data: 'first', loading: false, error: null });
  });

  it('waits for the connection, and reads again whenever it comes back', async () => {
    const { reads, read, wrapper, setConnectionState } = setup(false);
    const { rerender } = renderHook(() => useServerQuery(read, { input: 'a', initial: 'none' }), {
      wrapper,
    });
    expect(reads).toHaveLength(0);

    setConnectionState('connected');
    rerender();
    expect(reads).toHaveLength(1);
    await answer(reads[0], 'first');

    setConnectionState('reconnecting');
    rerender();
    expect(reads).toHaveLength(1);

    setConnectionState('connected');
    rerender();
    expect(reads).toHaveLength(2);
  });

  it("doesn't read again for a render with an equal input and new functions", () => {
    const { reads, read, wrapper } = setup();
    const { rerender } = renderHook(
      () =>
        useServerQuery((client, input, options) => read(client, input.name, options), {
          input: { name: 'a' },
          initial: 'none',
        }),
      { wrapper }
    );

    rerender();
    rerender();

    expect(reads).toHaveLength(1);
  });

  it('reads a new input with the query of the latest render', () => {
    const { reads, read, wrapper } = setup();
    const { rerender } = renderHook(
      ({ input, prefix }) =>
        useServerQuery((client, value, options) => read(client, prefix + value, options), {
          input,
          initial: 'none',
        }),
      { wrapper, initialProps: { input: 'a', prefix: 'old:' } }
    );

    rerender({ input: 'b', prefix: 'new:' });

    expect(reads.map((r) => r.input)).toEqual(['old:a', 'new:b']);
  });

  it('aborts a read a newer one replaces, and drops its reply', async () => {
    const { reads, read, wrapper } = setup();
    const { result, rerender } = renderHook(
      ({ input }) => useServerQuery(read, { input, initial: 'none' }),
      { wrapper, initialProps: { input: 'a' } }
    );

    rerender({ input: 'b' });
    expect(reads[0]?.signal.aborted).toBe(true);
    expect(reads[1]?.signal.aborted).toBe(false);

    await answer(reads[1], 'second');
    await answer(reads[0], 'too late');

    expect(result.current).toMatchObject({ data: 'second', loading: false });
  });

  it('reads through a new client when the client is replaced', () => {
    const { reads, read, wrapper, switchClient } = setup();
    const { rerender } = renderHook(() => useServerQuery(read, { input: 'a', initial: 'none' }), {
      wrapper,
    });

    switchClient({});
    rerender();

    expect(reads).toHaveLength(2);
    expect(reads[1]?.client).not.toBe(reads[0]?.client);
  });

  it('keeps the last good data after a failure, until a read succeeds', async () => {
    const { reads, read, wrapper } = setup();
    const { result, rerender } = renderHook(
      ({ input }) => useServerQuery(read, { input, initial: 'none' }),
      { wrapper, initialProps: { input: 'a' } }
    );
    await answer(reads[0], 'good');

    rerender({ input: 'b' });
    await answer(reads[1], new Error('Refused'));
    expect(result.current).toMatchObject({ data: 'good', error: 'Refused', loading: false });

    rerender({ input: 'c' });
    await answer(reads[2], 'better');
    expect(result.current).toMatchObject({ data: 'better', error: null });
  });

  it('toasts a failure under the title of the latest render, if it has one', async () => {
    const { reads, read, wrapper } = setup();
    const { rerender } = renderHook(
      ({ input, errorTitle }) =>
        useServerQuery(read, {
          input,
          initial: 'none',
          ...(errorTitle === undefined ? {} : { errorTitle }),
        }),
      {
        wrapper,
        initialProps: { input: 'a', errorTitle: undefined as string | undefined },
      }
    );
    await answer(reads[0], new Error('Refused'));
    expect(toast.error).not.toHaveBeenCalled();

    rerender({ input: 'b', errorTitle: "Couldn't read" });
    await answer(reads[1], new Error('Refused again'));

    expect(toast.error).toHaveBeenCalledWith("Couldn't read", {
      id: "Couldn't read",
      description: 'Refused again',
    });
  });

  it('aborts its read when unmounted', async () => {
    const { reads, read, wrapper } = setup();
    const { unmount } = renderHook(() => useServerQuery(read, { input: 'a', initial: 'none' }), {
      wrapper,
    });

    unmount();

    await waitFor(() => expect(reads[0]?.signal.aborted).toBe(true));
  });

  describe('with retry', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    const pass = (ms: number) => act(() => vi.advanceTimersByTime(ms));

    function retrying() {
      const { reads, read, wrapper } = setup();
      const view = renderHook(
        () =>
          useServerQuery(read, {
            input: 'a',
            initial: 'none',
            errorTitle: "Couldn't read",
            retry: true,
          }),
        { wrapper }
      );
      return { reads, ...view };
    }

    it('reads again, backing off, and is live once one succeeds', async () => {
      const { reads, result } = retrying();
      expect(result.current.status).toEqual({ state: 'loading' });

      await answer(reads[0], new Error('Refused'));
      expect(result.current.status).toEqual({
        state: 'failed',
        title: "Couldn't read",
        message: 'Refused',
      });
      pass(999);
      expect(reads).toHaveLength(1);
      pass(1);
      expect(reads).toHaveLength(2);

      await answer(reads[1], new Error('Refused'));
      pass(1999);
      expect(reads).toHaveLength(2);
      pass(1);
      expect(reads).toHaveLength(3);

      await answer(reads[2], 'value');
      expect(result.current.data).toBe('value');
      expect(result.current.status).toEqual({ state: 'live' });
    });

    it('toasts only the first failure of a run', async () => {
      const { reads } = retrying();

      await answer(reads[0], new Error('Refused'));
      pass(1000);
      await answer(reads[1], new Error('Refused'));

      expect(toast.error).toHaveBeenCalledTimes(1);
    });

    it('leaves a lost connection to the reconnect, not retrying or calling it a failure', async () => {
      const { reads, result } = retrying();

      await answer(reads[0], new ConnectionError('WebSocket closed'));
      pass(60_000);

      expect(reads).toHaveLength(1);
      expect(result.current.status).toEqual({ state: 'loading' });
    });

    it('stops trying once unmounted', async () => {
      const { reads, unmount } = retrying();
      await answer(reads[0], new Error('Refused'));

      unmount();
      pass(60_000);

      expect(reads).toHaveLength(1);
    });
  });

  it("doesn't read again after a failure without retry", async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { reads, read, wrapper } = setup();
    renderHook(() => useServerQuery(read, { input: 'a', initial: 'none' }), { wrapper });

    await answer(reads[0], new Error('Refused'));
    act(() => vi.advanceTimersByTime(60_000));
    vi.useRealTimers();

    expect(reads).toHaveLength(1);
  });
});
