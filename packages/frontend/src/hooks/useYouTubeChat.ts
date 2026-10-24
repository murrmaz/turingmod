import type { YouTubeChatState } from '@turingmod/shared';
import { MessageType } from '@turingmod/shared';
import { useCallback, useEffect, useState } from 'react';
import { useWebSocketContext } from '../context/WebSocketContext';
import { useWebSocketMessage } from './useWebSocket';

/**
 * Hook for the YouTube chat go-live control.
 *
 * YouTube exposes no push notification for "a broadcast started" that can reach a localhost-only
 * server, so the backend idles until something tells it to look for one. OBS does that
 * automatically when it starts streaming; this hook is the manual path for when OBS isn't running.
 *
 * The backend broadcasts every lifecycle transition, so `state` tracks whether chat is actually
 * connected rather than just whether the request was accepted.
 */
export function useYouTubeChat() {
  const { request, isConnected } = useWebSocketContext();
  const [state, setState] = useState<YouTubeChatState>('idle');
  const [pending, setPending] = useState(false);

  useWebSocketMessage(
    MessageType.YOUTUBE_CHAT_STATE,
    useCallback((payload) => {
      setState(payload.state);
    }, [])
  );

  // Transitions are pushed, so a console that stayed open keeps itself current. One that just
  // loaded or reconnected has missed them all, and would otherwise show "Not connected" over a
  // live stream — with Disconnect greyed out. So ask for the current state on every connect.
  useEffect(() => {
    if (!isConnected) {
      return;
    }

    let cancelled = false;

    void request(MessageType.YOUTUBE_GET_CHAT_STATE, {})
      .then((payload) => {
        if (!cancelled) {
          setState(payload.state);
        }
      })
      .catch((error: unknown) => {
        console.error('[useYouTubeChat] Failed to read initial chat state', error);
      });

    return () => {
      cancelled = true;
    };
  }, [isConnected, request]);

  const send = useCallback(
    async (type: MessageType.YOUTUBE_GO_LIVE | MessageType.YOUTUBE_GO_OFFLINE): Promise<void> => {
      setPending(true);
      try {
        await request(type, {});
      } catch (error) {
        console.error(`[useYouTubeChat] Request ${type} failed`, error);
        throw error;
      } finally {
        setPending(false);
      }
    },
    [request]
  );

  const goLive = useCallback(() => send(MessageType.YOUTUBE_GO_LIVE), [send]);
  const goOffline = useCallback(() => send(MessageType.YOUTUBE_GO_OFFLINE), [send]);

  return { state, pending, goLive, goOffline };
}
