import type { DependencyContainer } from 'tsyringe';
import { EventBus } from '../../core/EventBus.js';
import { DataInspector } from '../../database/DataInspector.js';
import { ActivityLogRepository } from '../../database/repositories/ActivityLogRepository.js';
import { CommandAvailability } from '../../features/commands/CommandAvailability.js';
import { CommandExecutor } from '../../features/commands/CommandExecutor.js';
import { CommandRegistry } from '../../features/commands/CommandRegistry.js';
import { PlatformLiveStatus } from '../../features/live/PlatformLiveStatus.js';
import { SuggestionBox } from '../../features/suggestions/SuggestionBox.js';
import { IntegrationManager } from '../../integrations/IntegrationManager.js';
import { YouTubeChatIntegration } from '../../integrations/implementations/youtube/YouTubeChatIntegration.js';
import { OAuthFlowService } from '../../integrations/OAuthFlowService.js';
import { StreamControlService } from '../../platforms/StreamControlService.js';
import { Logger } from '../../utils/Logger.js';
import { createActivityRouter } from './activityRouter.js';
import { createCommandsRouter } from './commandsRouter.js';
import { createDataRouter } from './dataRouter.js';
import { createIntegrationsRouter } from './integrationsRouter.js';
import { createLiveStateRouter } from './liveStateRouter.js';
import { createOAuthRouter } from './oauthRouter.js';
import { createSuggestionsRouter } from './suggestionsRouter.js';
import { router } from './trpc.js';
import { createYouTubeChatRouter } from './youtubeChatRouter.js';

/**
 * Every procedure the console can call over TRPC_PATH, one sub-router per area. A new request is
 * a procedure here and nothing else: its input schema, handler and output type are the contract.
 */
export function createAppRouter(container: DependencyContainer) {
  return router({
    activity: createActivityRouter(
      container.resolve(EventBus),
      container.resolve(ActivityLogRepository)
    ),
    integrations: createIntegrationsRouter(
      container.resolve(IntegrationManager),
      container.resolve(EventBus),
      container.resolve(Logger)
    ),
    commands: createCommandsRouter(
      container.resolve(CommandExecutor),
      container.resolve(CommandRegistry),
      container.resolve(CommandAvailability),
      container.resolve(StreamControlService),
      container.resolve(Logger)
    ),
    data: createDataRouter(container.resolve(DataInspector)),
    oauth: createOAuthRouter(
      container.resolve(OAuthFlowService),
      container.resolve(EventBus),
      container.resolve(Logger)
    ),
    liveState: createLiveStateRouter(
      container.resolve(PlatformLiveStatus),
      container.resolve(EventBus)
    ),
    suggestions: createSuggestionsRouter(
      container.resolve(SuggestionBox),
      container.resolve(EventBus)
    ),
    youtubeChat: createYouTubeChatRouter(
      container.resolve(YouTubeChatIntegration),
      container.resolve(EventBus),
      container.resolve(Logger)
    ),
  });
}

/** The router's type, which the console's client is typed against (`@turingmod/backend/trpc`). */
export type AppRouter = ReturnType<typeof createAppRouter>;
