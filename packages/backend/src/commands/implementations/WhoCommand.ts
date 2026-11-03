import type { CommandResult } from '@turingmod/shared';
import { PermissionLevel, PlatformCapability } from '@turingmod/shared';
import { injectable } from 'tsyringe';
import { StreamControlService } from '../../platforms/StreamControlService.js';
import type { CommandContext, ICommand } from '../interfaces/ICommand.js';
import { ok } from '../utils/results.js';

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
  readonly failureMessage = 'Failed to retrieve broadcaster info';

  constructor(private streamControl: StreamControlService) {}

  async execute(context: CommandContext): Promise<CommandResult> {
    const description = await this.streamControl
      .require(context.platform, 'broadcasterAbout')
      .getBroadcasterAbout();

    if (!description) {
      return ok('No description set');
    }

    return ok(`About: ${description}`);
  }
}

export default WhoCommand;
