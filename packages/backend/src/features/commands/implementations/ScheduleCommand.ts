import type { CommandResult } from '@turingmod/shared';
import { PermissionLevel, PlatformCapability } from '@turingmod/shared';
import { injectable } from 'tsyringe';
import { StreamControlService } from '../../../platforms/StreamControlService.js';
import { formatScheduleDate } from '../../../utils/FormatHelpers.js';
import type { CommandContext, ICommand } from '../interfaces/ICommand.js';
import { ok } from '../utils/results.js';

/**
 * !schedule command
 * Shows the next scheduled stream on the platform the command came from.
 */
@injectable()
export default class ScheduleCommand implements ICommand {
  readonly name = 'schedule';
  readonly description = 'Show upcoming stream schedule';
  readonly usage = '!schedule';
  readonly permissions = [PermissionLevel.VIEWER];
  /** Per-viewer, to keep a Helix-backed read off the rate limit. The schedule changes rarely, and this is the largest payload of these reads. */
  readonly cooldown = 60;
  readonly requiredCapabilities = [PlatformCapability.SCHEDULE];
  readonly failureMessage = 'Failed to retrieve stream schedule';

  constructor(private streamControl: StreamControlService) {}

  async execute(context: CommandContext): Promise<CommandResult> {
    const segments = await this.streamControl.require(context.platform, 'schedule').getSchedule();
    const nextSegment = segments[0];

    if (!nextSegment) {
      return ok('No upcoming scheduled streams');
    }

    const formattedDate = formatScheduleDate(nextSegment.startDate);
    const title = nextSegment.title ? ` - ${nextSegment.title}` : '';
    const category = nextSegment.category ? ` (${nextSegment.category})` : '';

    return ok(`Next stream: ${formattedDate}${title}${category}`);
  }
}
