import { PermissionLevel, StreamingPlatform } from '@turingmod/shared';
import type { CommandContext } from './interfaces/ICommand.js';
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
      id: 'viewer-id',
      platform: StreamingPlatform.TWITCH,
      platformUserId: 'viewer-id',
      username: 'Viewer',
      permissionLevel: PermissionLevel.VIEWER,
      ...user,
    },
    platform: StreamingPlatform.TWITCH,
    isSimulation,
  };
}
