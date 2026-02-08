import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Container } from '../core/Container.js';
import type { Logger } from '../utils/Logger.js';
import type { CommandRegistry } from './CommandRegistry.js';
import type { ICommand } from './interfaces/ICommand.js';

/**
 * Auto-discover and register commands from the implementations directory.
 *
 * Convention: each file in implementations/ exports exactly one command class.
 * The class constructor accepts a Container parameter for dependency injection.
 */
export async function loadCommands(
  container: Container,
  registry: CommandRegistry,
  logger: Logger
): Promise<void> {
  const dir = fileURLToPath(new URL('./implementations', import.meta.url));
  const files = await readdir(dir);

  // Deduplicate: prefer .ts (works with tsx in dev), fall back to .js (production/dist)
  const commandFiles = new Map<string, string>();
  for (const file of files) {
    if (file.endsWith('.d.ts') || file.endsWith('.map')) continue;
    if (file.endsWith('.ts')) {
      commandFiles.set(file.slice(0, -3), file);
    } else if (file.endsWith('.js') && !commandFiles.has(file.slice(0, -3))) {
      commandFiles.set(file.slice(0, -3), file);
    }
  }

  for (const file of commandFiles.values()) {
    const mod: Record<string, unknown> = await import(`./implementations/${file}`);

    for (const exported of Object.values(mod)) {
      if (typeof exported === 'function' && exported.prototype) {
        const command = new (exported as new (c: Container) => ICommand)(container);
        registry.register(command);
      }
    }
  }

  logger.info(`Loaded ${registry.count()} command(s) via auto-discovery`);
}
