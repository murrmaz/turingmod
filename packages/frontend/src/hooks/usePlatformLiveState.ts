import type { PlatformLiveState } from '@turingmod/shared';
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
