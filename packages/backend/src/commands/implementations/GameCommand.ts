import type { CommandContext, CommandResult } from '@turingmod/shared';
import { PermissionLevel, PlatformCapability } from '@turingmod/shared';
import type { Container } from '../../core/Container.js';
import { formatPlatformList } from '../../platforms/platformNames.js';
import type { StreamControlService } from '../../platforms/StreamControlService.js';
import type { Logger } from '../../utils/Logger.js';
import type { ICommand } from '../interfaces/ICommand.js';
import { checkPermission } from '../utils/permissionChecks.js';

/**
 * !game command
 * Shows the current stream game/category, or sets it (moderator only). Setting mirrors to every
 * live platform that supports SET_GAME (Twitch only in practice). Category name → id resolution
 * lives inside TwitchPlatform.
 */
export class GameCommand implements ICommand {
  readonly name = 'game';
  readonly description = 'Show or set the stream game/category';
  readonly usage = '!game [game name]';
  readonly permissions = [PermissionLevel.VIEWER];
  readonly cooldown = 0;
  readonly requiredCapabilities = [PlatformCapability.SET_GAME];

  private streamControl: StreamControlService;
  private logger: Logger;

  constructor(container: Container) {
    this.streamControl = container.resolve<StreamControlService>('StreamControlService');
    this.logger = container.resolve<Logger>('Logger').child({ command: 'game' });
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
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  }
}

export default GameCommand;
