import { messageOf } from '@turingmod/shared';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { type TrpcClient, useConnection, useTrpc } from '@/context/trpc-context';
import { LIVE, LOADING, type LoadStatus } from '@/lib/loadStatus';
import { reportLoadError } from '@/lib/reportError';
import { isConnectionError, reconnectDelay } from '@/services/connection';

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
  /**
   * Read again after a failure, backing off as a reconnect does, for data the console reads by itself
   * and nothing else would read again. Off for a view the streamer drives, whose next change reads.
   */
  retry?: boolean;
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
  const [status, setStatus] = useState<LoadStatus>(LOADING);
  const latestRead = useRef<AbortController | null>(null);
  const retryTimer = useRef<number | undefined>(undefined);
  const failures = useRef(0);
  // Wrapped, so that a query without input (`undefined`) still has a key.
  const key = JSON.stringify([options.input]);

  // Callers pass the query and options inline; a read uses the latest without causing one.
  /** Read now. Never rejects: a failure is reported and kept in `error`. */
  const read = useEffectEvent(async (client: TrpcClient): Promise<void> => {
    window.clearTimeout(retryTimer.current);
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
        setStatus(LIVE);
        failures.current = 0;
      }
    } catch (caught) {
      if (!controller.signal.aborted) {
        setError(messageOf(caught));
        const { errorTitle, retry = false } = options;
        // A retry's failure says nothing new, where a read the streamer asked for is news each time.
        if (errorTitle !== undefined && (!retry || failures.current === 0)) {
          reportLoadError(errorTitle, caught);
        }
        // A lost connection is the banner's to report, and everything is read again on reconnect.
        if (!isConnectionError(caught)) {
          setStatus({
            state: 'failed',
            title: errorTitle ?? "Couldn't load",
            message: messageOf(caught),
          });
          if (retry) {
            retryTimer.current = window.setTimeout(
              () => void read(client),
              reconnectDelay(failures.current)
            );
          }
          failures.current += 1;
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

  useEffect(
    () => () => {
      window.clearTimeout(retryTimer.current);
      latestRead.current?.abort();
    },
    []
  );

  return { data, loading, error, status };
}
