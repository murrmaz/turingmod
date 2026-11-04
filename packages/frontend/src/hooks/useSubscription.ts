import type { Unsubscribable } from '@trpc/server/observable';
import { messageOf } from '@turingmod/shared';
import { useCallback, useEffect, useEffectEvent, useState } from 'react';
import { type TrpcClient, useTrpc } from '@/context/trpc-context';
import { reportLoadError } from '@/lib/reportError';
import { isConnectionError, reconnectDelay } from '@/services/connection';

interface SubscriptionHandlers<T> {
  onData: (value: T) => void;
  onError: (error: unknown) => void;
}

type Subscribe<T> = (trpc: TrpcClient, handlers: SubscriptionHandlers<T>) => Unsubscribable;

/**
 * Where a subscription stands, so that a view never shows a failure, or data that hasn't arrived,
 * as if there were nothing to show. `loading` is until the first value; `failed` is until a retry
 * delivers one, and whatever value there was stays, though it may be out of date. A lost connection
 * doesn't count as failing, since the connection banner reports that.
 */
export type SubscriptionStatus =
  | { state: 'loading' | 'live' }
  | { state: 'failed'; title: string; message: string };

const LOADING: SubscriptionStatus = { state: 'loading' };
const LIVE: SubscriptionStatus = { state: 'live' };

/**
 * State the backend keeps the console in step with: a subscription that sends the current value
 * first and again on every change (`watch` on the backend). Nothing needs reading on connect,
 * since tRPC resubscribes after every reconnect and the first value replaces whatever went stale.
 *
 * Until the first value arrives, the state is `initial`. The setter returned beside it shows a
 * value the console got another way, such as a mutation's answer, until the next one arrives.
 *
 * With `reduce`, each value is an event that changes the state rather than replacing it (`events`
 * on the backend), e.g. a feed that starts from a seed and grows by one entry at a time.
 *
 * A backend error ends a subscription for good, reconnecting included, so it's subscribed again
 * here, backing off as a reconnect does. Only the first failure of a run is toasted, since the
 * status says the rest; a view shows it with SubscriptionFailure.
 *
 * @example useSubscription((trpc, on) => trpc.integrations.watch.subscribe(undefined, on), [], title)
 */
export function useSubscription<T>(
  subscribe: Subscribe<T>,
  initial: T,
  /** Toasted under this title if the subscription fails (see reportLoadError). */
  errorTitle: string
): [T, (value: T) => void, SubscriptionStatus];
export function useSubscription<T, S>(
  subscribe: Subscribe<T>,
  initial: S,
  errorTitle: string,
  reduce: (current: S, value: T) => S
): [S, (value: S) => void, SubscriptionStatus];
export function useSubscription<T, S>(
  subscribe: Subscribe<T>,
  initial: S,
  errorTitle: string,
  reduce?: (current: S, value: T) => S
): [S, (value: S) => void, SubscriptionStatus] {
  const trpc = useTrpc();
  const [state, setState] = useState(initial);
  const [status, setStatus] = useState(LOADING);
  // Callers pass these inline; the subscription is made once per client.
  const subscribeWith = useEffectEvent((client: TrpcClient, handlers: SubscriptionHandlers<T>) =>
    subscribe(client, handlers)
  );
  const receive = useEffectEvent((value: T) =>
    // Without `reduce`, the overloads make S and T the same type.
    setState((current) => (reduce ? reduce(current, value) : (value as unknown as S)))
  );

  useEffect(() => {
    let subscription: Unsubscribable | undefined;
    let retry: number | undefined;
    let failures = 0;
    const subscribeNow = () => {
      subscription = subscribeWith(trpc, {
        onData: (value) => {
          failures = 0;
          setStatus(LIVE);
          receive(value);
        },
        onError: (error) => {
          if (failures === 0) {
            reportLoadError(errorTitle, error);
          }
          if (!isConnectionError(error)) {
            setStatus({ state: 'failed', title: errorTitle, message: messageOf(error) });
          }
          retry = window.setTimeout(subscribeNow, reconnectDelay(failures));
          failures += 1;
        },
      });
    };
    subscribeNow();
    return () => {
      window.clearTimeout(retry);
      subscription?.unsubscribe();
    };
  }, [trpc, errorTitle]);

  const show = useCallback((value: S) => setState(() => value), []);
  return [state, show, status];
}
