import type { CommandContext, CommandResult } from '@turingmod/shared';
import { PermissionLevel } from '@turingmod/shared';
import type { Container } from '../../core/Container.js';
import type { TwitchApiIntegration } from '../../integrations/implementations/TwitchApiIntegration.js';
import type { TwitchAuthIntegration } from '../../integrations/implementations/TwitchAuthIntegration.js';
import type { Logger } from '../../utils/Logger.js';
import type { ICommand } from '../interfaces/ICommand.js';

/**
 * !cw command
 * Shows or sets content classification labels (content warnings)
 */
export class ContentWarningCommand implements ICommand {
  readonly name = 'cw';
  readonly description = 'Show or set content classification labels';
  readonly usage = '!cw [label1,label2,...]';
  readonly permissions = [PermissionLevel.VIEWER];
  readonly cooldown = 0;

  private twitchApi: TwitchApiIntegration;
  private authIntegration: TwitchAuthIntegration;
  private logger: Logger;

  constructor(container: Container) {
    this.twitchApi = container.resolve<TwitchApiIntegration>('TwitchApiIntegration');
    this.authIntegration = container.resolve<TwitchAuthIntegration>('TwitchAuthIntegration');
    this.logger = container.resolve<Logger>('Logger').child({ command: 'cw' });
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

      // Write mode: set new labels
      if (args.length > 1) {
        if (user.permissionLevel < PermissionLevel.MODERATOR) {
          return {
            success: false,
            message: 'Only moderators can edit content labels',
            error: {
              code: 'INSUFFICIENT_PERMISSIONS',
              message: 'Moderator required',
            },
          };
        }

        const labelsInput = args.slice(1).join(' ').trim();
        const labels = labelsInput
          .split(',')
          .map((label) => label.trim())
          .filter((label) => label !== '');

        await this.twitchApi.setContentClassificationLabels(userId, labels);

        return {
          success: true,
          message: 'Content labels updated',
          data: { labels },
        };
      }

      // Read mode: show current labels
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

      const labels = channel.contentClassificationLabels;

      if (!labels || labels.length === 0) {
        return {
          success: true,
          message: 'Content Labels: None',
          data: { labels: [] },
        };
      }

      return {
        success: true,
        message: `Content Labels: [${labels.join(', ')}]`,
        data: { labels },
      };
    } catch (error) {
      this.logger.error('Error in cw command', error);
      return {
        success: false,
        message: 'Failed to get/set content labels',
        error: {
          code: 'API_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  }
}
