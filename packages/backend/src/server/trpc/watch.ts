/**
 * The current value now, and again after every change, until `signal` aborts: the body of a
 * subscription that keeps the console in step with some state.
 *
 * Each value is read when it's sent, not when the change happened, so changes that arrive while
 * one is being sent collapse into the next read and a slow console never falls behind. Starting
 * with the current value means a console that just connected, or reconnected after missing
 * changes, needs no separate read.
 *
 * @param subscribe registers the change listener and returns its unsubscribe function
 */
export async function* watch<T>(
  read: () => T,
  subscribe: (onChange: () => void) => () => void,
  signal: AbortSignal | undefined
): AsyncGenerator<T> {
  let changed = false;
  let wake: (() => void) | null = null;
  const unsubscribe = subscribe(() => {
    changed = true;
    wake?.();
  });
  // Wakes the wait below, so a subscription stopped between changes ends at once.
  const onAbort = () => wake?.();
  signal?.addEventListener('abort', onAbort);

  try {
    while (!signal?.aborted) {
      changed = false;
      yield read();
      if (!(changed || signal?.aborted)) {
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
        wake = null;
      }
    }
  } finally {
    unsubscribe();
    signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * State any number of consoles watch, read once per change rather than once per console: the
 * value is kept until the next change, and every watcher that wakes for it sends the same one.
 * `subscribe` must report every change, or watchers keep sending a stale value.
 */
export function watchable<T>(read: () => T, subscribe: (onChange: () => void) => () => void) {
  let snapshot: { value: T } | null = null;
  // Never unsubscribed: it lives as long as the router that made it.
  subscribe(() => {
    snapshot = null;
  });
  const current = (): T => {
    snapshot ??= { value: read() };
    return snapshot.value;
  };
  return {
    /** The value now. */
    current,
    /** The body of a subscription to it (see watch). */
    watch: (signal: AbortSignal | undefined) => watch(current, subscribe, signal),
  };
}
