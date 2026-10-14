import type { CommandResult } from '@turingmod/shared';
import { PermissionLevel, PlatformCapability } from '@turingmod/shared';
import { injectable } from 'tsyringe';
import { StreamControlService } from '../../platforms/StreamControlService.js';
import { formatCountdown } from '../../utils/FormatHelpers.js';
import { Logger } from '../../utils/Logger.js';
import type { CommandContext, ICommand } from '../interfaces/ICommand.js';
import { toCommandError } from '../utils/commandErrors.js';
import { ok } from '../utils/results.js';

/**
 * !snooze command
 * Pushes the next ad back, if a snooze is left. The ad pre-warnings re-read the schedule before
 * each warning, so they follow the snooze on their own.
 */
@injectable()
export class SnoozeCommand implements ICommand {
  readonly name = 'snooze';
  readonly description = 'Snooze the next ad break';
  readonly usage = '!snooze';
  readonly permissions = [PermissionLevel.MODERATOR];
  readonly cooldown = 0;
  readonly requiredCapabilities = [PlatformCapability.ADS];

  private logger: Logger;

  constructor(
    private streamControl: StreamControlService,
    logger: Logger
  ) {
    this.logger = logger.child({ command: 'snooze' });
  }

  async execute(context: CommandContext): Promise<CommandResult> {
    const user = context.user.username;
    try {
      const result = await this.streamControl.require(context.platform, 'ads').snoozeNextAd();
      if (!result.snoozed) {
        return ok(`@${user}: There are no more snoozes left. Try again in a bit`);
      }
      const next = result.nextAdDate
        ? ` Next ad in ${formatCountdown(result.nextAdDate.getTime() - Date.now())}.`
        : '';
      return ok(`@${user}: Ads snoozed! There are ${result.snoozesLeft} left.${next}`);
    } catch (error) {
      this.logger.error('Error in snooze command', error);
      return toCommandError(error, 'Failed to snooze the next ad');
    }
  }
}

export default SnoozeCommand;
