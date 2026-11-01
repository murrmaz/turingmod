import type { Unsubscribable } from '@trpc/server/observable';
import { useCallback, useEffect, useEffectEvent, useState } from 'react';
import { type TrpcClient, useTrpc } from '@/context/trpc-context';
import { reportLoadError } from '@/lib/reportError';

interface SubscriptionHandlers<T> {
  onData: (value: T) => void;
  onError: (error: unknown) => void;
}

type Subscribe<T> = (trpc: TrpcClient, handlers: SubscriptionHandlers<T>) => Unsubscribable;

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
 * @example useSubscription((trpc, on) => trpc.integrations.watch.subscribe(undefined, on), [], title)
 */
export function useSubscription<T>(
  subscribe: Subscribe<T>,
  initial: T,
  /** Toasted under this title if the subscription fails (see reportLoadError). */
  errorTitle: string
): [T, (value: T) => void];
export function useSubscription<T, S>(
  subscribe: Subscribe<T>,
  initial: S,
  errorTitle: string,
  reduce: (current: S, value: T) => S
): [S, (value: S) => void];
export function useSubscription<T, S>(
  subscribe: Subscribe<T>,
  initial: S,
  errorTitle: string,
  reduce?: (current: S, value: T) => S
): [S, (value: S) => void] {
  const trpc = useTrpc();
  const [state, setState] = useState(initial);
  // Callers pass these inline; the subscription is made once per client.
  const subscribeWith = useEffectEvent((client: TrpcClient, handlers: SubscriptionHandlers<T>) =>
    subscribe(client, handlers)
  );
  const receive = useEffectEvent((value: T) =>
    // Without `reduce`, the overloads make S and T the same type.
    setState((current) => (reduce ? reduce(current, value) : (value as unknown as S)))
  );

  useEffect(() => {
    const subscription = subscribeWith(trpc, {
      onData: (value) => receive(value),
      onError: (error) => reportLoadError(errorTitle, error),
    });
    return () => subscription.unsubscribe();
  }, [trpc, errorTitle]);

  const show = useCallback((value: S) => setState(() => value), []);
  return [state, show];
}
