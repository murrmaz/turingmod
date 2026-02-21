import type { CommandContext, CommandResult } from '@turingmod/shared';
import { PermissionLevel } from '@turingmod/shared';
import type { Container } from '../../core/Container.js';
import type { TwitchApiIntegration } from '../../integrations/implementations/TwitchApiIntegration.js';
import type { TwitchAuthIntegration } from '../../integrations/implementations/TwitchAuthIntegration.js';
import type { Logger } from '../../utils/Logger.js';
import type { ICommand } from '../interfaces/ICommand.js';

/**
 * !title command
 * Shows the current stream title, or sets it (moderator only)
 */
export class TitleCommand implements ICommand {
  readonly name = 'title';
  readonly description = 'Show or set the stream title';
  readonly usage = '!title [new title]';
  readonly permissions = [PermissionLevel.VIEWER];
  readonly cooldown = 0;

  private twitchApi: TwitchApiIntegration;
  private authIntegration: TwitchAuthIntegration;
  private logger: Logger;

  constructor(container: Container) {
    this.twitchApi = container.resolve<TwitchApiIntegration>('TwitchApiIntegration');
    this.authIntegration = container.resolve<TwitchAuthIntegration>('TwitchAuthIntegration');
    this.logger = container.resolve<Logger>('Logger').child({ command: 'title' });
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

      // Write mode: set new title
      if (args.length > 1) {
        if (user.permissionLevel < PermissionLevel.MODERATOR) {
          return {
            success: false,
            message: 'Only moderators can edit stream title',
            error: {
              code: 'INSUFFICIENT_PERMISSIONS',
              message: 'Moderator required',
            },
          };
        }

        const newTitle = args.slice(1).join(' ').trim();

        if (newTitle === '') {
          return {
            success: false,
            message: 'Title cannot be empty',
            error: {
              code: 'INVALID_INPUT',
              message: 'Title must not be empty',
            },
          };
        }

        await this.twitchApi.setStreamTitle(userId, newTitle);

        return {
          success: true,
          message: `Title updated to: ${newTitle}`,
          data: { title: newTitle },
        };
      }

      // Read mode: show current title
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

      return {
        success: true,
        message: `Stream Title: ${channel.title}`,
        data: { title: channel.title },
      };
    } catch (error) {
      this.logger.error('Error in title command', error);
      return {
        success: false,
        message: 'Failed to get/set stream title',
        error: {
          code: 'API_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  }
}
