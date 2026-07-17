import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Container } from '../core/Container.js';
import type { Logger } from '../utils/Logger.js';
import type { CommandRegistry } from './CommandRegistry.js';
import type { ICommand } from './interfaces/ICommand.js';

/**
 * Auto-discover and register commands from the implementations directory.
 *
 * Convention: each file in implementations/ has a default export of its command
 * class, whose constructor accepts a Container parameter for dependency injection.
 * Only the default export is registered — other exports from the same file
 * (helpers, types) are ignored instead of being treated as commands.
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
    const mod: { default?: new (c: Container) => ICommand } = await import(
      `./implementations/${file}`
    );

    if (typeof mod.default !== 'function') {
      throw new Error(`Command file '${file}' has no default export`);
    }

    const command = new mod.default(container);
    registry.register(command);
  }

  logger.info(`Loaded ${registry.count()} command(s) via auto-discovery`);
}
