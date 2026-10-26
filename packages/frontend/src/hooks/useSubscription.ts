import type { Unsubscribable } from '@trpc/server/observable';
import { useCallback, useEffect, useRef, useState } from 'react';
import { type TrpcClient, useTrpc } from '@/context/TrpcContext';
import { reportLoadError } from '@/lib/reportError';

interface SubscriptionHandlers<T> {
  onData: (value: T) => void;
  onError: (error: unknown) => void;
}

/**
 * State the backend keeps the console in step with: a subscription that sends the current value
 * first and again on every change (`watch` on the backend). Nothing needs reading on connect,
 * since tRPC resubscribes after every reconnect and the first value replaces whatever went stale.
 *
 * Until the first value arrives, the state is `initial`. The setter returned beside it shows a
 * value the console got another way, such as a mutation's answer, until the next one arrives.
 *
 * @example useSubscription((trpc, on) => trpc.integrations.watch.subscribe(undefined, on), [], title)
 */
export function useSubscription<T>(
  subscribe: (trpc: TrpcClient, handlers: SubscriptionHandlers<T>) => Unsubscribable,
  initial: T,
  /** Toasted under this title if the subscription fails (see reportLoadError). */
  errorTitle: string
): [T, (value: T) => void] {
  const trpc = useTrpc();
  const [state, setState] = useState(initial);
  // Callers pass `subscribe` inline; the subscription is made once per client.
  const subscribeRef = useRef(subscribe);
  subscribeRef.current = subscribe;

  useEffect(() => {
    const subscription = subscribeRef.current(trpc, {
      onData: (value) => setState(() => value),
      onError: (error) => reportLoadError(errorTitle, error),
    });
    return () => subscription.unsubscribe();
  }, [trpc, errorTitle]);

  const show = useCallback((value: T) => setState(() => value), []);
  return [state, show];
}
