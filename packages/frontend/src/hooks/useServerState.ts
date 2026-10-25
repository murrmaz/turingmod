import type {
  RequestPayload,
  RequestType,
  ResponsePayload,
  ServerMessageType,
  ServerPayloads,
} from '@turingmod/shared';
import { messageOf } from '@turingmod/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useWebSocketContext } from '@/context/WebSocketContext';
import { reportLoadError } from '@/lib/reportError';

export interface ServerStateOptions<T extends RequestType, S, P extends ServerMessageType> {
  /** What to read with. Read again whenever it changes, compared by value. */
  payload: RequestPayload<T>;
  /** The state before the first reply. */
  initial: S;
  /** The state a reply makes, given the state it replaces. */
  onReply: (reply: ResponsePayload<T>, current: S) => S;
  /** The message the backend pushes when this changes, and the state each one makes. */
  push?: { type: P; apply: (payload: ServerPayloads[P], current: S) => S };
  /**
   * Toasted under this title when a read fails (see reportLoadError). Without one, a failure is
   * only returned as `error`, for a view that shows it in place.
   */
  errorTitle?: string;
}

/**
 * State the console reads from the backend. It's read on every connect, since a console that just
 * loaded or reconnected has missed every push, and again whenever the payload changes; a reply
 * to an older read is dropped. With `push`, the backend's own announcements keep it current
 * between reads.
 *
 * Until a read succeeds, `state` is `initial`; after a failed one it keeps the last good state.
 */
export function useServerState<T extends RequestType, S, P extends ServerMessageType = never>(
  type: T,
  options: ServerStateOptions<T, S, P>
) {
  const { request, isConnected, subscribe } = useWebSocketContext();
  const [state, setState] = useState(options.initial);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Callers pass options inline; reads and pushes use the latest without re-subscribing.
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const latestRead = useRef(0);
  const key = JSON.stringify(options.payload);

  /** Read now. Never rejects: a failure is reported and kept in `error`. */
  const refresh = useCallback(async (): Promise<void> => {
    const id = ++latestRead.current;
    setLoading(true);
    try {
      const reply = await request(type, optionsRef.current.payload);
      if (id === latestRead.current) {
        setState((current) => optionsRef.current.onReply(reply, current));
        setError(null);
      }
    } catch (caught) {
      if (id === latestRead.current) {
        setError(messageOf(caught));
        const { errorTitle } = optionsRef.current;
        if (errorTitle !== undefined) {
          reportLoadError(errorTitle, caught);
        }
      }
    } finally {
      if (id === latestRead.current) {
        setLoading(false);
      }
    }
  }, [request, type]);

  // `key` is the payload by value: a new one reads again.
  useEffect(() => {
    if (isConnected && key) {
      void refresh();
    }
  }, [isConnected, key, refresh]);

  const pushType = options.push?.type;
  useEffect(() => {
    if (pushType === undefined) {
      return;
    }
    return subscribe((message) => {
      const push = optionsRef.current.push;
      if (push && message.type === push.type) {
        setState((current) => push.apply(message.payload as ServerPayloads[P], current));
      }
    });
  }, [subscribe, pushType]);

  return { state, loading, error, refresh };
}
