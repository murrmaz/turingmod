import { container } from 'tsyringe';
import { type InjectableClass, importClasses } from '../utils/importImplementations.js';
import type { Logger } from '../utils/Logger.js';
import { BaseIntegration } from './BaseIntegration.js';
import type { IntegrationManager } from './IntegrationManager.js';

/**
 * Auto-discover and register every integration under the implementations directory: each class
 * a module there exports that extends BaseIntegration, whatever its file is called and however it
 * is exported, so helper modules can sit beside the integrations that use them.
 *
 * The order found doesn't matter. Resolving an integration constructs its dependencies first, as
 * the singletons the manager is later handed, and IntegrationManager orders startup and shutdown
 * from the dependency graph, never from the order of registration.
 *
 * Abstract integration base classes belong in integrations/, not implementations/: `abstract` is
 * erased at runtime, so one found here passes isIntegrationClass and stops startup: either
 * tsyringe can't construct it, or register() refuses it for having no name.
 */
export async function discoverIntegrations(
  manager: IntegrationManager,
  logger: Logger
): Promise<void> {
  const dir = new URL('./implementations/', import.meta.url);

  const integrationClasses = await importClasses(dir, isIntegrationClass);
  for (const integrationClass of integrationClasses) {
    manager.register(container.resolve(integrationClass));
  }

  logger.info(`Loaded ${integrationClasses.length} integration(s) via auto-discovery`);
}

function isIntegrationClass(value: unknown): value is InjectableClass<BaseIntegration> {
  return typeof value === 'function' && value.prototype instanceof BaseIntegration;
}
