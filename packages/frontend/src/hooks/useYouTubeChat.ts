import type { YouTubeChatState } from '@turingmod/shared';
import { useCallback, useState } from 'react';
import { useTrpc } from '@/context/trpc-context';
import { useSubscription } from './useSubscription';

const NOT_CONNECTED: YouTubeChatState = 'idle';

/**
 * Hook for the YouTube chat go-live control.
 *
 * YouTube exposes no push notification for "a broadcast started" that can reach a localhost-only
 * server, so the backend idles until something tells it to look for one. OBS does that
 * automatically when it starts streaming; this hook is the manual path for when OBS isn't running.
 *
 * The backend sends every lifecycle transition, so `state` tracks whether chat is actually
 * connected rather than just whether the request was accepted.
 */
export function useYouTubeChat() {
  const trpc = useTrpc();
  const [pending, setPending] = useState(false);
  const [state, showState] = useSubscription(
    (client, on) => client.youtubeChat.watch.subscribe(undefined, on),
    NOT_CONNECTED,
    "Couldn't read the YouTube chat state"
  );

  /** Run a request, showing the state it answers with as soon as it does. */
  const send = useCallback(
    async (mutate: () => Promise<YouTubeChatState>): Promise<void> => {
      setPending(true);
      try {
        showState(await mutate());
      } finally {
        setPending(false);
      }
    },
    [showState]
  );

  const goLive = useCallback(() => send(() => trpc.youtubeChat.goLive.mutate()), [send, trpc]);
  const goOffline = useCallback(
    () => send(() => trpc.youtubeChat.goOffline.mutate()),
    [send, trpc]
  );

  return { state, pending, goLive, goOffline };
}
