import type { YouTubeChatState } from '@turingmod/shared';
import { MessageType } from '@turingmod/shared';
import { useCallback, useState } from 'react';
import { useWebSocketContext } from '../context/WebSocketContext';
import { useServerState } from './useServerState';

const NOT_CONNECTED: YouTubeChatState = 'idle';

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
  const { request } = useWebSocketContext();
  const [pending, setPending] = useState(false);
  const { state } = useServerState(MessageType.YOUTUBE_GET_CHAT_STATE, {
    payload: {},
    initial: NOT_CONNECTED,
    onReply: (reply) => reply.state,
    push: { type: MessageType.YOUTUBE_CHAT_STATE, apply: (payload) => payload.state },
    errorTitle: "Couldn't read the YouTube chat state",
  });

  const send = useCallback(
    async (type: MessageType.YOUTUBE_GO_LIVE | MessageType.YOUTUBE_GO_OFFLINE): Promise<void> => {
      setPending(true);
      try {
        await request(type, {});
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
