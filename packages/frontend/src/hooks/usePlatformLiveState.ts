import type { PlatformLiveState } from '@turingmod/shared';
import { MessageType } from '@turingmod/shared';
import { useEffect, useState } from 'react';
import { useServerState } from './useServerState';

const NO_PLATFORMS: PlatformLiveState[] = [];

/** Whether each platform is live and since when, as the backend last pushed it. */
export function usePlatformLiveState(): PlatformLiveState[] {
  return useServerState(MessageType.PLATFORM_GET_LIVE_STATE, {
    payload: {},
    initial: NO_PLATFORMS,
    onReply: (reply) => reply.platforms,
    push: { type: MessageType.PLATFORM_LIVE_STATE, apply: (payload) => payload.platforms },
    errorTitle: "Couldn't read whether you're live",
  }).state;
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
