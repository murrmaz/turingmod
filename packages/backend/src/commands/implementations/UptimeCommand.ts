import type { CommandContext, CommandResult } from '@turingmod/shared';
import { PermissionLevel, PlatformCapability } from '@turingmod/shared';
import type { Container } from '../../core/Container.js';
import type { StreamControlService } from '../../platforms/StreamControlService.js';
import { formatDuration } from '../../utils/FormatHelpers.js';
import type { Logger } from '../../utils/Logger.js';
import type { ICommand } from '../interfaces/ICommand.js';

/**
 * !uptime command
 * Shows how long the stream has been live on the origin platform.
 */
export class UptimeCommand implements ICommand {
  readonly name = 'uptime';
  readonly description = 'Show how long the stream has been live';
  readonly usage = '!uptime';
  readonly permissions = [PermissionLevel.VIEWER];
  readonly cooldown = 0;
  readonly requiredCapabilities = [PlatformCapability.UPTIME];

  private streamControl: StreamControlService;
  private logger: Logger;

  constructor(container: Container) {
    this.streamControl = container.resolve<StreamControlService>('StreamControlService');
    this.logger = container.resolve<Logger>('Logger').child({ command: 'uptime' });
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
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  }
}

export default UptimeCommand;
