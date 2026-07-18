import type { CommandContext, CommandResult } from '@turingmod/shared';
import { PermissionLevel, type PlatformCapability } from '@turingmod/shared';
import type { Container } from '../../core/Container.js';
import type { TwitchApiIntegration } from '../../integrations/implementations/TwitchApiIntegration.js';
import type { TwitchAuthIntegration } from '../../integrations/implementations/TwitchAuthIntegration.js';
import type { Logger } from '../../utils/Logger.js';
import type { ICommand } from '../interfaces/ICommand.js';

/**
 * !who command
 * Shows the broadcaster's bio/description
 */
export class WhoCommand implements ICommand {
  readonly name = 'who';
  readonly description = 'Show the broadcaster bio/description';
  readonly usage = '!who';
  readonly permissions = [PermissionLevel.VIEWER];
  readonly cooldown = 0;
  // Reads the broadcaster bio via getUserById — no follow-age lookup, so no capability gate.
  readonly requiredCapabilities: PlatformCapability[] = [];

  private twitchApi: TwitchApiIntegration;
  private authIntegration: TwitchAuthIntegration;
  private logger: Logger;

  constructor(container: Container) {
    this.twitchApi = container.resolve<TwitchApiIntegration>('TwitchApiIntegration');
    this.authIntegration = container.resolve<TwitchAuthIntegration>('TwitchAuthIntegration');
    this.logger = container.resolve<Logger>('Logger').child({ command: 'who' });
  }

  async execute(_context: CommandContext): Promise<CommandResult> {
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

      const user = await this.twitchApi.getUserById(userId);
      const description = user?.description;

      if (!description || description.trim() === '') {
        return {
          success: true,
          message: 'No description set',
        };
      }

      return {
        success: true,
        message: `About: ${description}`,
        data: { description },
      };
    } catch (error) {
      this.logger.error('Error in who command', error);
      return {
        success: false,
        message: 'Failed to retrieve broadcaster info',
        error: {
          code: 'API_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  }
}

export default WhoCommand;
