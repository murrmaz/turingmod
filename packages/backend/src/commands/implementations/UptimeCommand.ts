import type { CommandContext, CommandResult } from '@turingmod/shared';
import { messageOf, PermissionLevel, PlatformCapability } from '@turingmod/shared';
import { injectable } from 'tsyringe';
import { StreamControlService } from '../../platforms/StreamControlService.js';
import { formatDuration } from '../../utils/FormatHelpers.js';
import { Logger } from '../../utils/Logger.js';
import type { ICommand } from '../interfaces/ICommand.js';

/**
 * !uptime command
 * Shows how long the stream has been live on the origin platform.
 */
@injectable()
export class UptimeCommand implements ICommand {
  readonly name = 'uptime';
  readonly description = 'Show how long the stream has been live';
  readonly usage = '!uptime';
  readonly permissions = [PermissionLevel.VIEWER];
  /** Per-viewer, to keep a Helix-backed read off the rate limit. A Helix call for a number nobody needs twice in half a minute. */
  readonly cooldown = 30;
  readonly requiredCapabilities = [PlatformCapability.UPTIME];

  private logger: Logger;

  constructor(
    private streamControl: StreamControlService,
    logger: Logger
  ) {
    this.logger = logger.child({ command: 'uptime' });
  }

  async execute(context: CommandContext): Promise<CommandResult> {
    try {
      const uptime = await this.streamControl.getUptime(context.platform);

      if (uptime === null) {
        return {
          success: true,
          message: 'Stream is offline',
        };
      }

      const formattedUptime = formatDuration(uptime);

      return {
        success: true,
        message: `Stream has been live for ${formattedUptime}`,
        data: { uptime },
      };
    } catch (error) {
      this.logger.error('Error in uptime command', error);
      return {
        success: false,
        message: 'Failed to retrieve stream uptime',
        error: {
          code: 'API_ERROR',
          message: messageOf(error),
        },
      };
    }
  }
}

export default UptimeCommand;
