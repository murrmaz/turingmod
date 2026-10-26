import { z } from 'zod';
import type { EventBus } from '../../core/EventBus.js';
import type { OAuthCompletedEvent } from '../../core/events.js';
import type { OAuthFlowService } from '../../integrations/OAuthFlowService.js';
import type { Logger } from '../../utils/Logger.js';
import { procedure, router } from './trpc.js';
import { events } from './watch.js';

/**
 * Signing in to an OAuth provider. The console only starts it: the provider redirects to the
 * backend's own callback (OAuthFlowService.handleCallback), which exchanges the code itself, so a
 * sign-in completes even if no console is open. Adding a provider needs no change here, only an
 * IOAuthIntegration.
 */
export function createOAuthRouter(oauthFlow: OAuthFlowService, eventBus: EventBus, logger: Logger) {
  const log = logger.child({ component: 'OAuthRouter' });

  return router({
    /**
     * The provider's authorization page, for the console to open. The asking console's origin is
     * kept with the attempt, so the callback page can send the streamer back to it.
     */
    authorizationUrl: procedure
      .input(z.strictObject({ integrationName: z.string().min(1) }))
      .mutation(({ input: { integrationName }, ctx }) => {
        log.info(`Getting auth URL for: ${integrationName}`);
        return oauthFlow.getAuthorizationUrl(integrationName, ctx.consoleOrigin);
      }),

    /**
     * How each authorization ends, from now on. Every console gets every result, since the one
     * that asked may have reconnected or closed since; it never carries the code.
     */
    results: procedure.subscription(({ signal }) =>
      events<OAuthCompletedEvent>((onResult) => eventBus.on('oauth.completed', onResult), signal)
    ),
  });
}
