import type { PlatformLiveState } from '@turingmod/shared';
import { MessageType } from '@turingmod/shared';
import { useCallback, useEffect, useState } from 'react';
import { useWebSocketContext } from '../context/WebSocketContext';
import { useWebSocketMessage } from './useWebSocket';

/**
 * Whether each platform is live and since when. Changes are pushed; a console that just loaded or
 * reconnected has missed them, so it asks on every connect.
 */
export function usePlatformLiveState(): PlatformLiveState[] {
  const { request, isConnected } = useWebSocketContext();
  const [platforms, setPlatforms] = useState<PlatformLiveState[]>([]);

  useWebSocketMessage(
    MessageType.PLATFORM_LIVE_STATE,
    useCallback((payload) => setPlatforms(payload.platforms), [])
  );

  useEffect(() => {
    if (!isConnected) {
      return;
    }
    let cancelled = false;
    request(MessageType.PLATFORM_GET_LIVE_STATE, {})
      .then((payload) => {
        if (!cancelled) {
          setPlatforms(payload.platforms);
        }
      })
      .catch((error: unknown) => {
        console.error('[usePlatformLiveState] Failed to read live state', error);
      });
    return () => {
      cancelled = true;
    };
  }, [isConnected, request]);

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
