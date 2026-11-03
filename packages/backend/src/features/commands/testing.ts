import { type ExecutionResult, PermissionLevel, StreamingPlatform } from '@turingmod/shared';
import { EventBus } from '../../core/EventBus.js';
import { Logger } from '../../utils/Logger.js';
import type { CommandAvailability } from './CommandAvailability.js';
import { CommandExecutor } from './CommandExecutor.js';
import type { CommandContext, ICommand } from './interfaces/ICommand.js';
import { parseCommand } from './parseCommand.js';

/**
 * Test helper: the context a Twitch viewer's chat message `text` runs with, parsed as chat parses
 * it. `overrides` replaces fields of the user, and `isSimulation`.
 */
export function commandContext(
  text: string,
  overrides: Partial<CommandContext['user']> & { isSimulation?: boolean } = {}
): CommandContext {
  const parsed = parseCommand(text);
  if (!parsed) {
    throw new Error(`Not a command: ${text}`);
  }
  const { isSimulation = false, ...user } = overrides;
  return {
    ...parsed,
    user: {
      platformUserId: 'viewer-id',
      username: 'Viewer',
      permissionLevel: PermissionLevel.VIEWER,
      ...user,
    },
    platform: StreamingPlatform.TWITCH,
    isSimulation,
  };
}

/** Test helper: run a command as chat does, through the real executor, which reports its failures. */
export function runCommand(command: ICommand, context: CommandContext): Promise<ExecutionResult> {
  const logger = new Logger({ level: 'silent' });
  const availability = { find: () => command } as unknown as CommandAvailability;
  return new CommandExecutor(availability, new EventBus(logger), logger).execute(context);
}

/** Test helper: a result's error code, or undefined for a success. */
export function errorCodeOf(result: ExecutionResult): string | undefined {
  return result.success ? undefined : result.error.code;
}
