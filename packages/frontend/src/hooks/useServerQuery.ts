import { messageOf } from '@turingmod/shared';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { type TrpcClient, useConnection, useTrpc } from '@/context/trpc-context';
import { reportLoadError } from '@/lib/reportError';

export interface ServerQueryOptions<I, T> {
  /** What to read with. Read again whenever it changes, compared by value. */
  input: I;
  /** The data before the first reply. */
  initial: T;
  /**
   * Toasted under this title when a read fails (see reportLoadError). Without one, a failure is
   * only returned as `error`, for a view that shows it in place.
   */
  errorTitle?: string;
}

/**
 * Data the console reads from a tRPC query. It's read whenever the connection comes up, since a
 * console that just loaded or reconnected may be showing stale data, and again whenever the input
 * changes; a read that a newer one replaces is aborted, and its reply dropped. For state the
 * backend keeps current by itself, use useSubscription instead.
 *
 * Until a read succeeds, `data` is `initial`; after a failed one it keeps the last good data.
 *
 * @example useServerQuery((trpc, input, opts) => trpc.data.queryRows.query(input, opts), options)
 */
export function useServerQuery<I, T>(
  query: (trpc: TrpcClient, input: I, options: { signal: AbortSignal }) => Promise<T>,
  options: ServerQueryOptions<I, T>
) {
  const trpc = useTrpc();
  const connected = useConnection().connectionState === 'connected';
  const [data, setData] = useState(options.initial);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const latestRead = useRef<AbortController | null>(null);
  // Wrapped, so that a query without input (`undefined`) still has a key.
  const key = JSON.stringify([options.input]);

  // Callers pass the query and options inline; a read uses the latest without causing one.
  /** Read now. Never rejects: a failure is reported and kept in `error`. */
  const read = useEffectEvent(async (client: TrpcClient): Promise<void> => {
    latestRead.current?.abort();
    const controller = new AbortController();
    latestRead.current = controller;
    setLoading(true);
    try {
      const reply = await query(client, options.input, { signal: controller.signal });
      if (!controller.signal.aborted) {
        // An updater, since the data may itself be a function.
        setData(() => reply);
        setError(null);
      }
    } catch (caught) {
      if (!controller.signal.aborted) {
        setError(messageOf(caught));
        const { errorTitle } = options;
        if (errorTitle !== undefined) {
          reportLoadError(errorTitle, caught);
        }
      }
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  });

  // `key` is the input by value: a new one reads again.
  useEffect(() => {
    if (connected && key) {
      void read(trpc);
    }
  }, [connected, key, trpc]);

  useEffect(() => () => latestRead.current?.abort(), []);

  return { data, loading, error };
}
