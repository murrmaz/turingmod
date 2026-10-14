import type { CommandResult } from '@turingmod/shared';
import { PermissionLevel, PlatformCapability } from '@turingmod/shared';
import { injectable } from 'tsyringe';
import { StreamControlService } from '../../platforms/StreamControlService.js';
import { formatScheduleDate } from '../../utils/FormatHelpers.js';
import { Logger } from '../../utils/Logger.js';
import type { CommandContext, ICommand } from '../interfaces/ICommand.js';
import { toCommandError } from '../utils/commandErrors.js';

/**
 * !schedule command
 * Shows the next scheduled stream on the platform the command came from.
 */
@injectable()
export class ScheduleCommand implements ICommand {
  readonly name = 'schedule';
  readonly description = 'Show upcoming stream schedule';
  readonly usage = '!schedule';
  readonly permissions = [PermissionLevel.VIEWER];
  /** Per-viewer, to keep a Helix-backed read off the rate limit. The schedule changes rarely, and this is the largest payload of these reads. */
  readonly cooldown = 60;
  readonly requiredCapabilities = [PlatformCapability.SCHEDULE];

  private logger: Logger;

  constructor(
    private streamControl: StreamControlService,
    logger: Logger
  ) {
    this.logger = logger.child({ command: 'schedule' });
  }

  async execute(context: CommandContext): Promise<CommandResult> {
    try {
      const segments = await this.streamControl.require(context.platform, 'schedule').getSchedule();
      const nextSegment = segments[0];

      if (!nextSegment) {
        return {
          success: true,
          message: 'No upcoming scheduled streams',
        };
      }

      const formattedDate = formatScheduleDate(nextSegment.startDate);
      const title = nextSegment.title ? ` - ${nextSegment.title}` : '';
      const category = nextSegment.category ? ` (${nextSegment.category})` : '';

      return {
        success: true,
        message: `Next stream: ${formattedDate}${title}${category}`,
        data: {
          startDate: nextSegment.startDate.toISOString(),
          title: nextSegment.title,
          categoryName: nextSegment.category,
        },
      };
    } catch (error) {
      this.logger.error('Error in schedule command', error);
      return toCommandError(error, 'Failed to retrieve stream schedule');
    }
  }
}

export default ScheduleCommand;
