import { container } from 'tsyringe';
import { importImplementations } from '../utils/importImplementations.js';
import type { Logger } from '../utils/Logger.js';
import type { IRewardHandler } from './interfaces/IRewardHandler.js';
import type { RewardRegistry } from './RewardRegistry.js';

/**
 * Auto-discover and register reward handlers from the implementations directory, the same way
 * loadCommands does for commands.
 */
export async function loadRewardHandlers(registry: RewardRegistry, logger: Logger): Promise<void> {
  const dir = new URL('./implementations/', import.meta.url);

  for (const handlerClass of await importImplementations<IRewardHandler>(dir, 'Reward handler', {
    allowMissing: true,
  })) {
    registry.register(container.resolve(handlerClass));
  }

  logger.info(`Loaded ${registry.count()} reward handler(s) via auto-discovery`);
}
