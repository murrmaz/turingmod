import type { DependencyContainer } from 'tsyringe';
import { EventBus } from '../../core/EventBus.js';
import { IntegrationManager } from '../../integrations/IntegrationManager.js';
import { Logger } from '../../utils/Logger.js';
import { createIntegrationsRouter } from './integrationsRouter.js';
import { router } from './trpc.js';

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
  });
}

/** The router's type, which the console's client is typed against (`@turingmod/backend/trpc`). */
export type AppRouter = ReturnType<typeof createAppRouter>;
