import type { CommandContext, CommandResult } from '@turingmod/shared';
import { PermissionLevel } from '@turingmod/shared';
import type { Container } from '../../core/Container.js';
import type { TwitchApiIntegration } from '../../integrations/implementations/TwitchApiIntegration.js';
import type { TwitchAuthIntegration } from '../../integrations/implementations/TwitchAuthIntegration.js';
import type { Logger } from '../../utils/Logger.js';
import type { ICommand } from '../interfaces/ICommand.js';
import { checkPermission } from '../utils/permissionChecks.js';

/**
 * !tags command
 * Shows the current stream tags, or sets them (moderator only)
 */
export class TagsCommand implements ICommand {
  readonly name = 'tags';
  readonly description = 'Show or set the stream tags';
  readonly usage = '!tags [tag1,tag2,...]';
  readonly permissions = [PermissionLevel.VIEWER];
  readonly cooldown = 0;

  private twitchApi: TwitchApiIntegration;
  private authIntegration: TwitchAuthIntegration;
  private logger: Logger;

  constructor(container: Container) {
    this.twitchApi = container.resolve<TwitchApiIntegration>('TwitchApiIntegration');
    this.authIntegration = container.resolve<TwitchAuthIntegration>('TwitchAuthIntegration');
    this.logger = container.resolve<Logger>('Logger').child({ command: 'tags' });
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

      // Write mode: set new tags
      if (args.length > 1) {
        const permissionError = checkPermission(
          user.permissionLevel,
          PermissionLevel.MODERATOR,
          'edit stream tags'
        );
        if (permissionError) {
          return permissionError;
        }

        const tagsInput = args.slice(1).join(' ').trim();
        const tags = tagsInput
          .split(',')
          .map((tag) => tag.trim())
          .filter((tag) => tag !== '');

        await this.twitchApi.setStreamTags(userId, tags);

        return {
          success: true,
          message: `Tags updated: [${tags.join(', ')}]`,
          data: { tags },
        };
      }

      // Read mode: show current tags
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

      const tags = channel.tags;

      if (!tags || tags.length === 0) {
        return {
          success: true,
          message: 'Tags: None',
          data: { tags: [] },
        };
      }

      return {
        success: true,
        message: `Tags: [${tags.join(', ')}]`,
        data: { tags },
      };
    } catch (error) {
      this.logger.error('Error in tags command', error);
      return {
        success: false,
        message: 'Failed to get/set stream tags',
        error: {
          code: 'API_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  }
}
