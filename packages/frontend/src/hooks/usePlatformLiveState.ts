import type { PlatformLiveState, PlatformLiveStatePayload } from '@turingmod/shared';
import { createMessage, MessageType } from '@turingmod/shared';
import { useCallback, useEffect, useState } from 'react';
import { useWebSocketContext } from '../context/WebSocketContext';
import { useWebSocketMessage } from './useWebSocket';

/**
 * Whether each platform is live and since when. Changes are pushed; a console that just loaded or
 * reconnected has missed them, so it asks on every connect.
 */
export function usePlatformLiveState(): PlatformLiveState[] {
  const { sendAndWaitForResponse, isConnected } = useWebSocketContext();
  const [platforms, setPlatforms] = useState<PlatformLiveState[]>([]);

  useWebSocketMessage<PlatformLiveStatePayload>(
    MessageType.PLATFORM_LIVE_STATE,
    useCallback((message) => setPlatforms(message.payload.platforms), [])
  );

  useEffect(() => {
    if (!isConnected) {
      return;
    }
    let cancelled = false;
    sendAndWaitForResponse<PlatformLiveStatePayload>(
      createMessage(MessageType.PLATFORM_GET_LIVE_STATE, {})
    )
      .then((response) => {
        if (!cancelled) {
          setPlatforms(response.payload.platforms);
        }
      })
      .catch((error: unknown) => {
        console.error('[usePlatformLiveState] Failed to read live state', error);
      });
    return () => {
      cancelled = true;
    };
  }, [isConnected, sendAndWaitForResponse]);

  return platforms;
}

/** The current time, updated every second, for uptimes that tick. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}
