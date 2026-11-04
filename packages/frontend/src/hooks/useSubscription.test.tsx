import { act, renderHook, waitFor } from '@testing-library/react';
import { createTRPCClient, createWSClient, wsLink } from '@trpc/client';
import { initTRPC } from '@trpc/server';
import { applyWSSHandler } from '@trpc/server/adapters/ws';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import {
  type Connection,
  type RouterOutputs,
  type TrpcClient,
  TrpcClientProvider,
} from '@/context/trpc-context';
import { ConnectionError } from '@/services/connection';
import { failWhileDisconnected } from '@/services/trpcLinks';
import { FakeSubscription } from '@/testing/fakeTrpc';
import { switchableConnection } from '@/testing/render-console';
import { useSubscription } from './useSubscription';

const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

type Suggestion = RouterOutputs['suggestions']['delete'][number];

const TITLE = "Couldn't read suggestions";
const NONE: Suggestion[] = [];
const idea = (id: number): Suggestion => ({
  id,
  suggestion: `idea ${id}`,
  suggestedBy: null,
  createdAt: id,
});

function setup() {
  const watch = new FakeSubscription<Suggestion[]>();
  const subscribe = vi.spyOn(watch, 'subscribe');
  const connection = switchableConnection({ suggestions: { watch } });
  return { watch, subscribe, ...connection };
}

/** The hook, subscribed to `suggestions.watch` as the console's pages are. */
function watching(wrapper: ReturnType<typeof switchableConnection>['wrapper']) {
  return renderHook(
    () =>
      useSubscription((trpc, on) => trpc.suggestions.watch.subscribe(undefined, on), NONE, TITLE),
    { wrapper }
  );
}

describe('useSubscription', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts from the initial value, and each value replaces the last', () => {
    const { watch, wrapper } = setup();
    const { result } = renderHook(
      () =>
        useSubscription((trpc, on) => trpc.suggestions.watch.subscribe(undefined, on), NONE, TITLE),
      { wrapper }
    );
    expect(result.current[0]).toEqual([]);

    watch.emit([idea(1)]);
    watch.emit([idea(2)]);

    expect(result.current[0]).toEqual([idea(2)]);
  });

  it('shows a value from elsewhere until the next one arrives', () => {
    const { watch, wrapper } = setup();
    const { result } = renderHook(
      () =>
        useSubscription((trpc, on) => trpc.suggestions.watch.subscribe(undefined, on), NONE, TITLE),
      { wrapper }
    );

    act(() => result.current[1]([idea(5)]));
    expect(result.current[0]).toEqual([idea(5)]);

    watch.emit([idea(6)]);
    expect(result.current[0]).toEqual([idea(6)]);
  });

  it('subscribes once, though each render passes new functions', () => {
    const { subscribe, wrapper } = setup();
    const { rerender } = renderHook(
      () =>
        useSubscription((trpc, on) => trpc.suggestions.watch.subscribe(undefined, on), NONE, TITLE),
      { wrapper }
    );

    rerender();
    rerender();

    expect(subscribe).toHaveBeenCalledTimes(1);
  });

  it('applies each event with the reduce of the latest render', () => {
    const { watch, subscribe, wrapper } = setup();
    const { result, rerender } = renderHook(
      ({ step }) =>
        useSubscription(
          (trpc, on) => trpc.suggestions.watch.subscribe(undefined, on),
          0,
          TITLE,
          (count: number) => count + step
        ),
      { wrapper, initialProps: { step: 1 } }
    );

    watch.emit([]);
    expect(result.current[0]).toBe(1);

    rerender({ step: 10 });
    watch.emit([]);

    expect(result.current[0]).toBe(11);
    expect(subscribe).toHaveBeenCalledTimes(1);
  });

  it('moves to a new client, leaving the old one', () => {
    const { watch, wrapper, switchClient } = setup();
    const { result, rerender } = renderHook(
      () =>
        useSubscription((trpc, on) => trpc.suggestions.watch.subscribe(undefined, on), NONE, TITLE),
      { wrapper }
    );
    const next = new FakeSubscription<Suggestion[]>();

    switchClient({ suggestions: { watch: next } });
    rerender();
    watch.emit([idea(1)]);
    expect(result.current[0]).toEqual([]);

    next.emit([idea(2)]);
    expect(result.current[0]).toEqual([idea(2)]);
  });

  it('stops listening once unmounted', () => {
    const { watch, wrapper } = setup();
    const unsubscribed = vi.fn();
    const { unmount } = renderHook(
      () =>
        useSubscription(
          (trpc, on) => {
            const subscription = trpc.suggestions.watch.subscribe(undefined, on);
            return {
              unsubscribe: () => {
                unsubscribed();
                subscription.unsubscribe();
              },
            };
          },
          NONE,
          TITLE
        ),
      { wrapper }
    );

    unmount();

    expect(unsubscribed).toHaveBeenCalledTimes(1);
    watch.emit([idea(1)]);
  });

  it('reports a failed subscription under its title', () => {
    const { watch, wrapper } = setup();
    renderHook(
      () =>
        useSubscription((trpc, on) => trpc.suggestions.watch.subscribe(undefined, on), NONE, TITLE),
      { wrapper }
    );

    watch.fail(new Error('Stream lost'));

    expect(toast.error).toHaveBeenCalledWith(TITLE, { id: TITLE, description: 'Stream lost' });
  });

  describe('status', () => {
    it('is loading until the first value, then live', () => {
      const { watch, wrapper } = setup();
      const { result } = watching(wrapper);
      expect(result.current[2]).toEqual({ state: 'loading' });

      watch.emit([]);

      expect(result.current[2]).toEqual({ state: 'live' });
    });

    it('says what failed, keeping the value there was', () => {
      const { watch, wrapper } = setup();
      const { result } = watching(wrapper);
      watch.emit([idea(1)]);

      watch.fail(new Error('Database is locked'));

      expect(result.current[0]).toEqual([idea(1)]);
      expect(result.current[2]).toEqual({
        state: 'failed',
        title: TITLE,
        message: 'Database is locked',
      });
    });

    it("doesn't count a lost connection as failing, which the banner reports", () => {
      const { watch, wrapper } = setup();
      const { result } = watching(wrapper);
      watch.emit([]);

      watch.fail(new ConnectionError('WebSocket closed'));

      expect(result.current[2]).toEqual({ state: 'live' });
      expect(toast.error).not.toHaveBeenCalled();
    });
  });

  describe('after a failure', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    });

    const pass = (ms: number) => act(() => vi.advanceTimersByTime(ms));

    it('subscribes again, backing off, and is live once a value arrives', () => {
      const { watch, subscribe, wrapper } = setup();
      const { result } = watching(wrapper);

      watch.fail(new Error('Database is locked'));
      pass(999);
      expect(subscribe).toHaveBeenCalledTimes(1);
      pass(1);
      expect(subscribe).toHaveBeenCalledTimes(2);

      watch.fail(new Error('Database is locked'));
      pass(1999);
      expect(subscribe).toHaveBeenCalledTimes(2);
      pass(1);
      expect(subscribe).toHaveBeenCalledTimes(3);

      watch.emit([idea(1)]);
      expect(result.current[0]).toEqual([idea(1)]);
      expect(result.current[2]).toEqual({ state: 'live' });
    });

    it('waits the shortest time again once it has recovered', () => {
      const { watch, subscribe, wrapper } = setup();
      watching(wrapper);
      watch.fail(new Error('Database is locked'));
      pass(1000);
      watch.emit([]);

      watch.fail(new Error('Database is locked'));
      pass(1000);

      expect(subscribe).toHaveBeenCalledTimes(3);
    });

    it('toasts only the first failure of a run', () => {
      const { watch, wrapper } = setup();
      watching(wrapper);

      watch.fail(new Error('Database is locked'));
      pass(1000);
      watch.fail(new Error('Database is locked'));
      expect(toast.error).toHaveBeenCalledTimes(1);

      pass(2000);
      watch.emit([]);
      watch.fail(new Error('Database is locked'));
      expect(toast.error).toHaveBeenCalledTimes(2);
    });

    it('stops trying once unmounted', () => {
      const { watch, subscribe, wrapper } = setup();
      const { unmount } = watching(wrapper);
      watch.fail(new Error('Database is locked'));

      unmount();
      pass(60_000);

      expect(subscribe).toHaveBeenCalledTimes(1);
    });
  });

  describe('over a real connection', () => {
    const t = initTRPC.create();

    it('comes back from a read that failed on the backend, which tRPC never does by itself', async () => {
      let subscribes = 0;
      let failNow = false;
      const router = t.router({
        suggestions: t.router({
          watch: t.procedure.subscription(async function* ({ signal }) {
            subscribes += 1;
            yield [idea(subscribes)];
            while (!signal?.aborted) {
              await new Promise((resolve) => setTimeout(resolve, 10));
              if (failNow) {
                failNow = false;
                throw new Error('Database is locked');
              }
            }
          }),
        }),
      });
      const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
      await new Promise((resolve) => server.once('listening', resolve));
      applyWSSHandler({ wss: server, router });
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      const socket = createWSClient({
        url: `ws://127.0.0.1:${port}`,
        // A Node socket, where the console's is the browser's. tRPC uses what the two share.
        // biome-ignore lint/style/useNamingConvention: tRPC's own name for this option
        WebSocket: WebSocket as unknown as typeof globalThis.WebSocket,
      });
      // Not the console's router, but the one procedure this reads has the shape it expects.
      const client = createTRPCClient<typeof router>({
        links: [failWhileDisconnected(socket), wsLink({ client: socket })],
      }) as unknown as TrpcClient;
      const connection: Connection = { connectionState: 'connected', retry: () => {} };

      const { result, unmount } = watching(({ children }) => (
        <TrpcClientProvider client={client} connection={connection}>
          {children}
        </TrpcClientProvider>
      ));
      try {
        await waitFor(() => expect(result.current[0]).toEqual([idea(1)]));

        failNow = true;
        await waitFor(() => expect(result.current[2]).toMatchObject({ state: 'failed' }));
        await waitFor(() => expect(result.current[0]).toEqual([idea(2)]));

        expect(result.current[2]).toEqual({ state: 'live' });
      } finally {
        unmount();
        await socket.close();
        server.close();
      }
    });
  });
});
