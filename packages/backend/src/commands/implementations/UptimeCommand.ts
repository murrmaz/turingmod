import type { CommandContext, CommandResult } from '@turingmod/shared';
import { PermissionLevel } from '@turingmod/shared';
import type { Container } from '../../core/Container.js';
import type { TwitchApiIntegration } from '../../integrations/implementations/TwitchApiIntegration.js';
import type { TwitchAuthIntegration } from '../../integrations/implementations/TwitchAuthIntegration.js';
import { formatDuration } from '../../utils/FormatHelpers.js';
import type { Logger } from '../../utils/Logger.js';
import type { ICommand } from '../interfaces/ICommand.js';

/**
 * !uptime command
 * Shows how long the stream has been live
 */
export class UptimeCommand implements ICommand {
  readonly name = 'uptime';
  readonly description = 'Show how long the stream has been live';
  readonly usage = '!uptime';
  readonly permissions = [PermissionLevel.VIEWER];
  readonly cooldown = 0;

  private twitchApi: TwitchApiIntegration;
  private authIntegration: TwitchAuthIntegration;
  private logger: Logger;

  constructor(container: Container) {
    this.twitchApi = container.resolve<TwitchApiIntegration>('TwitchApiIntegration');
    this.authIntegration = container.resolve<TwitchAuthIntegration>('TwitchAuthIntegration');
    this.logger = container.resolve<Logger>('Logger').child({ command: 'uptime' });
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
          message: 'Stream is offline',
        };
      }

      const uptime = Date.now() - stream.startDate.getTime();
      const formattedUptime = formatDuration(uptime);

      return {
        success: true,
        message: `Stream has been live for ${formattedUptime}`,
        data: { uptime, startDate: stream.startDate.toISOString() },
      };
    } catch (error) {
      this.logger.error('Error in uptime command', error);
      return {
        success: false,
        message: 'Failed to retrieve stream uptime',
        error: {
          code: 'API_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  }
}

export default UptimeCommand;
