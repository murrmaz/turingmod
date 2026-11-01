import { TRPCClientError, type TRPCLink, type TRPCWebSocketClient } from '@trpc/client';
import type { AnyRouter } from '@trpc/server';
import { observable } from '@trpc/server/observable';
import { ConnectionError, NOT_CONNECTED_MESSAGE } from './connection';

/**
 * Fail a query or mutation at once while disconnected, rather than let tRPC queue it: an action the streamer clicked during an outage must not run later, after
 * they've given up on it. A request the connection was lost under fails as a ConnectionError,
 * which the connection banner already reports. Subscriptions are left to tRPC, which starts
 * them once connected and resubscribes after every reconnect.
 */
export function failWhileDisconnected(
  wsClient: Pick<TRPCWebSocketClient, 'connectionState'>
): TRPCLink<AnyRouter> {
  return () =>
    ({ op, next }) =>
      observable((observer) => {
        if (op.type !== 'subscription' && wsClient.connectionState.get().state !== 'pending') {
          observer.error(TRPCClientError.from(new ConnectionError(NOT_CONNECTED_MESSAGE)));
          return;
        }
        return next(op).subscribe({
          next: (result) => observer.next(result),
          // Only an error the backend answered with has a shape; any other is the connection's.
          error: (error) =>
            observer.error(
              error.shape === undefined
                ? TRPCClientError.from(new ConnectionError(error.message))
                : error
            ),
          complete: () => observer.complete(),
        });
      });
}
