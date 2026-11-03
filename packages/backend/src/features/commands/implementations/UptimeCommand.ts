import type { CommandResult } from '@turingmod/shared';
import { PermissionLevel, PlatformCapability } from '@turingmod/shared';
import { injectable } from 'tsyringe';
import { StreamControlService } from '../../../platforms/StreamControlService.js';
import { formatDuration } from '../../../utils/FormatHelpers.js';
import type { CommandContext, ICommand } from '../interfaces/ICommand.js';
import { ok } from '../utils/results.js';

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
  readonly failureMessage = 'Failed to retrieve stream uptime';

  constructor(private streamControl: StreamControlService) {}

  async execute(context: CommandContext): Promise<CommandResult> {
    const uptime = await this.streamControl.getUptime(context.platform);

    if (uptime === null) {
      return ok('Stream is offline');
    }

    const formattedUptime = formatDuration(uptime);

    return ok(`Stream has been live for ${formattedUptime}`);
  }
}

export default UptimeCommand;
