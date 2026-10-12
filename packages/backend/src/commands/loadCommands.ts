import { container } from 'tsyringe';
import { importImplementations } from '../utils/importImplementations.js';
import type { Logger } from '../utils/Logger.js';
import type { CommandRegistry } from './CommandRegistry.js';
import type { ICommand } from './interfaces/ICommand.js';

/**
 * Auto-discover and register commands from the implementations directory.
 *
 * Each file's default-exported class is resolved through tsyringe and registered; see
 * importImplementations for the file conventions.
 */
export async function loadCommands(registry: CommandRegistry, logger: Logger): Promise<void> {
  const dir = new URL('./implementations/', import.meta.url);

  for (const commandClass of await importImplementations<ICommand>(dir, 'Command')) {
    registry.register(container.resolve(commandClass));
  }

  logger.info(`Loaded ${registry.count()} command(s) via auto-discovery`);
}
