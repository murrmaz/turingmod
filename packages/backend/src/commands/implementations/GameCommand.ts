import type { CommandContext, CommandResult } from '@turingmod/shared';
import { messageOf, PermissionLevel, PlatformCapability } from '@turingmod/shared';
import { injectable } from 'tsyringe';
import { formatPlatformList } from '../../platforms/platformNames.js';
import { StreamControlService } from '../../platforms/StreamControlService.js';
import { Logger } from '../../utils/Logger.js';
import type { ICommand } from '../interfaces/ICommand.js';
import { checkPermission } from '../utils/permissionChecks.js';

/**
 * !game command
 * Shows the current stream game/category, or sets it (moderator only). Setting mirrors to every
 * live platform that supports SET_GAME (Twitch only in practice). Category name → id resolution
 * lives inside TwitchPlatform.
 */
@injectable()
export class GameCommand implements ICommand {
  readonly name = 'game';
  readonly description = 'Show or set the stream game/category';
  readonly usage = '!game [game name]';
  readonly permissions = [PermissionLevel.VIEWER];
  /** Per-viewer, to keep a Helix-backed read off the rate limit. Throttles the viewer-readable branch; moderators are exempt, so !game <name> stays responsive. */
  readonly cooldown = 30;
  readonly requiredCapabilities = [PlatformCapability.SET_GAME];

  private logger: Logger;

  constructor(
    private streamControl: StreamControlService,
    logger: Logger
  ) {
    this.logger = logger.child({ command: 'game' });
  }

  async execute(context: CommandContext): Promise<CommandResult> {
    const { user, args } = context;

    try {
      // Write mode: set new game (mirrors to all live platforms that support SET_GAME)
      if (args.length > 1) {
        const permissionError = checkPermission(
          user.permissionLevel,
          PermissionLevel.MODERATOR,
          'edit stream game'
        );
        if (permissionError) {
          return permissionError;
        }

        const gameName = args.slice(1).join(' ').trim();

        if (gameName === '') {
          return {
            success: false,
            message: 'Game name cannot be empty',
            error: {
              code: 'INVALID_INPUT',
              message: 'Game name must not be empty',
            },
          };
        }

        const mirror = await this.streamControl.setGame(gameName);

        if (mirror.updated.length === 0) {
          const reason = mirror.failures[0]?.error ?? 'No live platforms to update';
          return {
            success: false,
            message: `Failed to update game: ${reason}`,
            error: {
              code: 'API_ERROR',
              message: reason,
            },
          };
        }

        return {
          success: true,
          message: `Game changed to ${gameName} on ${formatPlatformList(mirror.updated)}`,
          data: { gameName, updated: mirror.updated },
        };
      }

      // Read mode: show current game on the origin platform
      const info = await this.streamControl.getStreamInfo(context.platform);

      if (!info.game || info.game === '') {
        return {
          success: true,
          message: 'No game/category set',
          data: { gameName: undefined },
        };
      }

      return {
        success: true,
        message: `Current Game: ${info.game}`,
        data: { gameName: info.game },
      };
    } catch (error) {
      this.logger.error('Error in game command', error);
      return {
        success: false,
        message: 'Failed to get/set stream game',
        error: {
          code: 'API_ERROR',
          message: messageOf(error),
        },
      };
    }
  }
}

export default GameCommand;
