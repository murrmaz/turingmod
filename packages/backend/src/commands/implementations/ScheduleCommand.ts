import type { CommandContext, CommandResult } from '@turingmod/shared';
import { PermissionLevel, PlatformCapability } from '@turingmod/shared';
import type { Container } from '../../core/Container.js';
import type { TwitchApiIntegration } from '../../integrations/implementations/TwitchApiIntegration.js';
import type { TwitchAuthIntegration } from '../../integrations/implementations/TwitchAuthIntegration.js';
import { formatScheduleDate } from '../../utils/FormatHelpers.js';
import type { Logger } from '../../utils/Logger.js';
import type { ICommand } from '../interfaces/ICommand.js';

/**
 * !schedule command
 * Shows the next scheduled stream
 */
export class ScheduleCommand implements ICommand {
  readonly name = 'schedule';
  readonly description = 'Show upcoming stream schedule';
  readonly usage = '!schedule';
  readonly permissions = [PermissionLevel.VIEWER];
  readonly cooldown = 0;
  readonly requiredCapabilities = [PlatformCapability.SCHEDULE];

  private twitchApi: TwitchApiIntegration;
  private authIntegration: TwitchAuthIntegration;
  private logger: Logger;

  constructor(container: Container) {
    this.twitchApi = container.resolve<TwitchApiIntegration>('TwitchApiIntegration');
    this.authIntegration = container.resolve<TwitchAuthIntegration>('TwitchAuthIntegration');
    this.logger = container.resolve<Logger>('Logger').child({ command: 'schedule' });
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

      const schedule = await this.twitchApi.getSchedule(userId);

      if (!schedule) {
        return {
          success: true,
          message: 'No upcoming scheduled streams',
        };
      }

      // Access segments from the schedule data
      const scheduleData = schedule.data;
      const segments = scheduleData.segments;

      if (!segments || segments.length === 0) {
        return {
          success: true,
          message: 'No upcoming scheduled streams',
        };
      }

      const nextSegment = segments[0];

      if (!nextSegment) {
        return {
          success: true,
          message: 'No upcoming scheduled streams',
        };
      }

      const formattedDate = formatScheduleDate(nextSegment.startDate);
      const category = nextSegment.categoryName ? ` (${nextSegment.categoryName})` : '';
      const title = nextSegment.title ? ` - ${nextSegment.title}` : '';

      return {
        success: true,
        message: `Next stream: ${formattedDate}${title}${category}`,
        data: {
          startDate: nextSegment.startDate.toISOString(),
          title: nextSegment.title,
          categoryName: nextSegment.categoryName,
        },
      };
    } catch (error) {
      this.logger.error('Error in schedule command', error);
      return {
        success: false,
        message: 'Failed to retrieve stream schedule',
        error: {
          code: 'API_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  }
}

export default ScheduleCommand;
