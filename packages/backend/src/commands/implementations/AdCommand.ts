import type { CommandContext, CommandResult } from '@turingmod/shared';
import { PermissionLevel, PlatformCapability } from '@turingmod/shared';
import type { Container } from '../../core/Container.js';
import type { TwitchApiIntegration } from '../../integrations/implementations/TwitchApiIntegration.js';
import type { TwitchAuthIntegration } from '../../integrations/implementations/TwitchAuthIntegration.js';
import { formatDuration } from '../../utils/FormatHelpers.js';
import type { Logger } from '../../utils/Logger.js';
import type { ICommand } from '../interfaces/ICommand.js';

/**
 * !ad command
 * Shows time until the next ad break
 */
export class AdCommand implements ICommand {
  readonly name = 'ad';
  readonly description = 'Show time until next ad break';
  readonly usage = '!ad';
  readonly permissions = [PermissionLevel.VIEWER];
  readonly cooldown = 0;
  readonly requiredCapabilities = [PlatformCapability.ADS];

  private twitchApi: TwitchApiIntegration;
  private authIntegration: TwitchAuthIntegration;
  private logger: Logger;

  constructor(container: Container) {
    this.twitchApi = container.resolve<TwitchApiIntegration>('TwitchApiIntegration');
    this.authIntegration = container.resolve<TwitchAuthIntegration>('TwitchAuthIntegration');
    this.logger = container.resolve<Logger>('Logger').child({ command: 'ad' });
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

      const stream = await this.twitchApi.getStream(userId);

      if (!stream) {
        return {
          success: true,
          message: 'Stream is offline - no ads scheduled',
        };
      }

      const adSchedule = await this.twitchApi.getAdSchedule(userId);

      if (!adSchedule?.nextAdDate) {
        return {
          success: true,
          message: 'Ad information unavailable',
        };
      }

      const timeUntilAd = adSchedule.nextAdDate.getTime() - Date.now();

      if (timeUntilAd <= 0) {
        return {
          success: true,
          message: 'Next ad break is scheduled now or has passed',
        };
      }

      const formattedTime = formatDuration(timeUntilAd);

      return {
        success: true,
        message: `Next ad in ${formattedTime}`,
        data: {
          nextAdAt: adSchedule.nextAdDate.toISOString(),
          timeUntilAd,
        },
      };
    } catch (error) {
      this.logger.error('Error in ad command', error);
      return {
        success: false,
        message: 'Failed to retrieve ad schedule',
        error: {
          code: 'API_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  }
}

export default AdCommand;
