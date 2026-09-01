import type { YouTubeChatState, YouTubeChatStatePayload } from '@turingmod/shared';
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
  const { sendAndWaitForResponse, isConnected } = useWebSocketContext();
  const [state, setState] = useState<YouTubeChatState>('idle');
  const [pending, setPending] = useState(false);

  useWebSocketMessage<YouTubeChatStatePayload>(
    MessageType.YOUTUBE_CHAT_STATE,
    useCallback((message) => {
      setState(message.payload.state);
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

    void sendAndWaitForResponse<YouTubeChatStatePayload>({
      id: crypto.randomUUID(),
      type: MessageType.YOUTUBE_GET_CHAT_STATE,
      timestamp: Date.now(),
      payload: {},
    })
      .then((response) => {
        if (!cancelled) {
          setState(response.payload.state);
        }
      })
      .catch((error: unknown) => {
        console.error('[useYouTubeChat] Failed to read initial chat state', error);
      });

    return () => {
      cancelled = true;
    };
  }, [isConnected, sendAndWaitForResponse]);

  const send = useCallback(
    async (type: MessageType): Promise<void> => {
      setPending(true);
      try {
        await sendAndWaitForResponse({
          id: crypto.randomUUID(),
          type,
          timestamp: Date.now(),
          payload: {},
        });
      } catch (error) {
        console.error(`[useYouTubeChat] Request ${type} failed`, error);
        throw error;
      } finally {
        setPending(false);
      }
    },
    [sendAndWaitForResponse]
  );

  const goLive = useCallback(() => send(MessageType.YOUTUBE_GO_LIVE), [send]);
  const goOffline = useCallback(() => send(MessageType.YOUTUBE_GO_OFFLINE), [send]);

  return { state, pending, goLive, goOffline };
}
