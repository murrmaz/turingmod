import type { CommandContext, CommandResult } from '@turingmod/shared';
import { PermissionLevel, PlatformCapability } from '@turingmod/shared';
import { injectable } from 'tsyringe';
import { StreamControlService } from '../../platforms/StreamControlService.js';
import { Logger } from '../../utils/Logger.js';
import type { ICommand } from '../interfaces/ICommand.js';
import { toCommandError } from '../utils/commandErrors.js';

/**
 * !who command
 * Shows the broadcaster's bio/description on the platform the command came from.
 */
@injectable()
export class WhoCommand implements ICommand {
  readonly name = 'who';
  readonly description = 'Show the broadcaster bio/description';
  readonly usage = '!who';
  readonly permissions = [PermissionLevel.VIEWER];
  /** Per-viewer, to keep a Helix-backed read off the rate limit. The channel bio almost never changes. */
  readonly cooldown = 60;
  readonly requiredCapabilities = [PlatformCapability.BROADCASTER_ABOUT];

  private logger: Logger;

  constructor(
    private streamControl: StreamControlService,
    logger: Logger
  ) {
    this.logger = logger.child({ command: 'who' });
  }

  async execute(context: CommandContext): Promise<CommandResult> {
    try {
      const description = await this.streamControl.getBroadcasterAbout(context.platform);

      if (!description) {
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
      return toCommandError(error, 'Failed to retrieve broadcaster info');
    }
  }
}

export default WhoCommand;
