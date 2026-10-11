import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { container } from 'tsyringe';
import type { Logger } from '../utils/Logger.js';
import type { CommandRegistry } from './CommandRegistry.js';
import type { ICommand } from './interfaces/ICommand.js';

/**
 * Auto-discover and register commands from the implementations directory.
 *
 * Convention: each file in implementations/ has a default export of its command
 * class, decorated with @injectable() so tsyringe can construct it from its
 * typed constructor parameters alone. Only the default export is registered —
 * other exports from the same file (helpers, types) are ignored instead of
 * being treated as commands.
 *
 * Every non-test file here is imported at startup, so a file without a default export is a
 * hard startup failure, not a silently skipped file.
 */
export async function loadCommands(registry: CommandRegistry, logger: Logger): Promise<void> {
  const dir = fileURLToPath(new URL('./implementations', import.meta.url));
  const files = await readdir(dir);

  // Deduplicate: prefer .ts, fall back to .js (dev and production both run from dist/ now,
  // but this keeps the loader correct if it's ever pointed at a raw src/ directory again)
  const commandFiles = new Map<string, string>();
  for (const file of files) {
    if (file.endsWith('.d.ts') || file.endsWith('.map')) continue;
    // Tests live beside their subjects (repo convention), but this directory is imported
    // wholesale at startup — importing a suite would run vitest outside the test runner and
    // abort boot. Skip them rather than relocating the tests away from their subjects.
    if (/\.test\.[cm]?[jt]s$/.test(file)) continue;
    if (file.endsWith('.ts')) {
      commandFiles.set(file.slice(0, -3), file);
    } else if (file.endsWith('.js') && !commandFiles.has(file.slice(0, -3))) {
      commandFiles.set(file.slice(0, -3), file);
    }
  }

  for (const file of commandFiles.values()) {
    // biome-ignore lint/suspicious/noExplicitAny: constructor param types vary per command; tsyringe resolves them from decorator metadata.
    const mod: { default?: new (...args: any[]) => ICommand } = await import(
      `./implementations/${file}`
    );

    if (typeof mod.default !== 'function') {
      throw new Error(`Command file '${file}' has no default export`);
    }

    const command = container.resolve(mod.default);
    registry.register(command);
  }

  logger.info(`Loaded ${registry.count()} command(s) via auto-discovery`);
}
