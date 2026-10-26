import type { PlatformLiveState } from '@turingmod/shared';
import { useEffect, useState } from 'react';
import { useSubscription } from './useSubscription';

const NO_PLATFORMS: PlatformLiveState[] = [];

/** Whether each platform is live and since when, as the backend last sent it. */
export function usePlatformLiveState(): PlatformLiveState[] {
  const [platforms] = useSubscription(
    (trpc, on) => trpc.liveState.watch.subscribe(undefined, on),
    NO_PLATFORMS,
    "Couldn't read whether you're live"
  );
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
