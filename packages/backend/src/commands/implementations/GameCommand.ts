import type { CommandContext, CommandResult } from '@turingmod/shared';
import { PermissionLevel } from '@turingmod/shared';
import type { Container } from '../../core/Container.js';
import type { TwitchApiIntegration } from '../../integrations/implementations/TwitchApiIntegration.js';
import type { TwitchAuthIntegration } from '../../integrations/implementations/TwitchAuthIntegration.js';
import type { Logger } from '../../utils/Logger.js';
import type { ICommand } from '../interfaces/ICommand.js';

/**
 * !game command
 * Shows the current stream game/category, or sets it (moderator only)
 */
export class GameCommand implements ICommand {
  readonly name = 'game';
  readonly description = 'Show or set the stream game/category';
  readonly usage = '!game [game name]';
  readonly permissions = [PermissionLevel.VIEWER];
  readonly cooldown = 0;

  private twitchApi: TwitchApiIntegration;
  private authIntegration: TwitchAuthIntegration;
  private logger: Logger;

  constructor(container: Container) {
    this.twitchApi = container.resolve<TwitchApiIntegration>('TwitchApiIntegration');
    this.authIntegration = container.resolve<TwitchAuthIntegration>('TwitchAuthIntegration');
    this.logger = container.resolve<Logger>('Logger').child({ command: 'game' });
  }

  async execute(context: CommandContext): Promise<CommandResult> {
    const { user, args } = context;

    try {
      const userId = this.authIntegration.getAuthenticatedUserId();
      if (!userId) {
        return {
          success: false,
          message: 'Not authenticated with Twitch',
          error: {
            code: 'NOT_AUTHENTICATED',
            message: 'Complete OAuth first',
          },
        };
      }

      // Write mode: set new game
      if (args.length > 1) {
        if (user.permissionLevel < PermissionLevel.MODERATOR) {
          return {
            success: false,
            message: 'Only moderators can edit stream game',
            error: {
              code: 'INSUFFICIENT_PERMISSIONS',
              message: 'Moderator required',
            },
          };
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

        const game = await this.twitchApi.searchGame(gameName);

        if (!game) {
          return {
            success: false,
            message: `Game not found: ${gameName}. Try another name.`,
            error: {
              code: 'GAME_NOT_FOUND',
              message: `No game found matching "${gameName}"`,
            },
          };
        }

        await this.twitchApi.setStreamGame(userId, game.id);

        return {
          success: true,
          message: `Game changed to: ${game.name}`,
          data: { gameId: game.id, gameName: game.name },
        };
      }

      // Read mode: show current game
      const channel = await this.twitchApi.getChannel(userId);

      if (!channel) {
        return {
          success: false,
          message: 'Failed to retrieve channel information',
          error: {
            code: 'API_ERROR',
            message: 'Channel not found',
          },
        };
      }

      if (!channel.gameName || channel.gameName === '') {
        return {
          success: true,
          message: 'No game/category set',
          data: { gameName: undefined },
        };
      }

      return {
        success: true,
        message: `Current Game: ${channel.gameName}`,
        data: { gameId: channel.gameId, gameName: channel.gameName },
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
