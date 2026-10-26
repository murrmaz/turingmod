import type { DependencyContainer } from 'tsyringe';
import { EventBus } from '../../core/EventBus.js';
import { IntegrationManager } from '../../integrations/IntegrationManager.js';
import { YouTubeChatIntegration } from '../../integrations/implementations/youtube/YouTubeChatIntegration.js';
import { PlatformLiveStatus } from '../../live/PlatformLiveStatus.js';
import { Logger } from '../../utils/Logger.js';
import { createIntegrationsRouter } from './integrationsRouter.js';
import { createLiveStateRouter } from './liveStateRouter.js';
import { router } from './trpc.js';
import { createYouTubeChatRouter } from './youtubeChatRouter.js';

/**
 * Every procedure the console can call over TRPC_PATH, one sub-router per area. A new request is
 * a procedure here and nothing else: its input schema, handler and output type are the contract.
 */
export function createAppRouter(container: DependencyContainer) {
  return router({
    integrations: createIntegrationsRouter(
      container.resolve(IntegrationManager),
      container.resolve(EventBus),
      container.resolve(Logger)
    ),
    liveState: createLiveStateRouter(container.resolve(PlatformLiveStatus)),
    youtubeChat: createYouTubeChatRouter(
      container.resolve(YouTubeChatIntegration),
      container.resolve(EventBus),
      container.resolve(Logger)
    ),
  });
}

/** The router's type, which the console's client is typed against (`@turingmod/backend/trpc`). */
export type AppRouter = ReturnType<typeof createAppRouter>;
