import type { EventBus } from '../../core/EventBus.js';
import type { PlatformLiveStatus } from '../../features/live/PlatformLiveStatus.js';
import { procedure, router } from './trpc.js';
import { watchable } from './watch.js';

/** Whether each platform is live and since when, for the console's header badges. */
export function createLiveStateRouter(liveStatus: PlatformLiveStatus, eventBus: EventBus) {
  const states = watchable(
    () => liveStatus.getStates(),
    (onChange) => eventBus.on('platform.liveState.changed', onChange)
  );

  return router({
    /** Every platform's live state, sent on subscribing and again whenever any of them changes. */
    watch: procedure.subscription(({ signal }) => states.watch(signal)),
  });
}
