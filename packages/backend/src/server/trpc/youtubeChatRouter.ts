import { IntegrationName } from '@turingmod/shared';
import type { EventBus } from '../../core/EventBus.js';
import type { YouTubeChatIntegration } from '../../integrations/implementations/youtube/YouTubeChatIntegration.js';
import type { Logger } from '../../utils/Logger.js';
import { procedure, router } from './trpc.js';
import { watchable } from './watch.js';

/**
 * The YouTube chat go-live control. YouTube offers no push notification for "a broadcast started"
 * that reaches a localhost-only server, so the console needs a way to say "I'm live, go find the
 * chat" (and the reverse). OBS does the same on its own when it starts streaming.
 */
export function createYouTubeChatRouter(
  chatIntegration: YouTubeChatIntegration,
  eventBus: EventBus,
  logger: Logger
) {
  const log = logger.child({ component: 'YouTubeChatRouter' });
  const state = watchable(
    () => chatIntegration.getState(),
    (onChange) => eventBus.on('youtube.chat.state', onChange)
  );

  return router({
    /**
     * Where chat is (idle, resolving, streaming), sent on subscribing and on every transition, so
     * the console shows whether chat actually connected, not just that a request was accepted.
     */
    watch: procedure.subscription(({ signal }) => state.watch(signal)),

    /**
     * Start looking for an active broadcast and connect its chat; answers with the state that
     * left. Refused when the integration isn't running, since nothing would happen and the
     * console would otherwise be told it worked.
     */
    goLive: procedure.mutation(() => {
      log.info('Go-live requested from the console');
      if (!chatIntegration.isRunning()) {
        throw new Error(
          `${IntegrationName.YOUTUBE_CHAT} isn't running: start it on the Integrations page`
        );
      }
      chatIntegration.connectChat('console');
      return state.current();
    }),

    /** Disconnect from chat and return to idle; answers with the state that left. */
    goOffline: procedure.mutation(() => {
      log.info('Go-offline requested from the console');
      chatIntegration.disconnectChat('console');
      return state.current();
    }),
  });
}
