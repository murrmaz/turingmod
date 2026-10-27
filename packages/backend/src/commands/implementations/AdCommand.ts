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
 * !ad command
 * Shows time until the next ad break on the platform the command came from.
 */
@injectable()
export class AdCommand implements ICommand {
  readonly name = 'ad';
  readonly description = 'Show time until next ad break';
  readonly usage = '!ad';
  readonly permissions = [PermissionLevel.VIEWER];
  /** Per-viewer, to keep a Helix-backed read off the rate limit. Two Helix calls per invocation, for an answer that only moves minute to minute. */
  readonly cooldown = 30;
  readonly requiredCapabilities = [PlatformCapability.ADS];

  private logger: Logger;

  constructor(
    private streamControl: StreamControlService,
    logger: Logger
  ) {
    this.logger = logger.child({ command: 'ad' });
  }

  async execute(context: CommandContext): Promise<CommandResult> {
    try {
      const adBreak = await this.streamControl.require(context.platform, 'ads').getNextAdBreak();

      if (!adBreak) {
        return ok('Stream is offline - no ads scheduled');
      }

      if (!adBreak.nextAdDate) {
        return ok('Ad information unavailable');
      }

      const timeUntilAd = adBreak.nextAdDate.getTime() - Date.now();

      if (timeUntilAd <= 0) {
        return ok('Next ad break is scheduled now or has passed');
      }

      return ok(`Next ad in ${formatCountdown(timeUntilAd)}`);
    } catch (error) {
      this.logger.error('Error in ad command', error);
      return toCommandError(error, 'Failed to retrieve ad schedule');
    }
  }
}

export default AdCommand;
