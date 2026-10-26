/**
 * The console's connection to the backend (the tRPC client in TrpcContext): where it stands, how
 * often it retries, and how a request that failed for want of it is told apart.
 */

/**
 * Where the connection stands. `connecting` is only the first attempt; once a connection has
 * failed or dropped, it's `reconnecting` until one opens again.
 */
export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'closed';

/** The first retry waits this long, doubling each time it fails, up to RECONNECT_MAX_MS. */
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30_000;

/** How long to wait before the next connection attempt, after `failedAttempts` in a row. */
export function reconnectDelay(failedAttempts: number): number {
  return Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** failedAttempts);
}

export const NOT_CONNECTED_MESSAGE = 'Not connected to TuringMod';

/**
 * A request got no answer because there was no connection, or it was lost first. Kept apart from
 * an error the backend answered with, since the connection banner already reports this one.
 */
export class ConnectionError extends Error {
  override name = 'ConnectionError';
}

/** Whether a request failed for want of a connection (tRPC's client error wraps it as its cause). */
export function isConnectionError(error: unknown): boolean {
  return (
    error instanceof ConnectionError ||
    (error instanceof Error && error.cause instanceof ConnectionError)
  );
}
