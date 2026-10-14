import type { CommandResult } from '@turingmod/shared';
import { PermissionLevel, PlatformCapability } from '@turingmod/shared';
import { injectable } from 'tsyringe';
import { StreamControlService } from '../../platforms/StreamControlService.js';
import { formatElapsed } from '../../utils/FormatHelpers.js';
import { Logger } from '../../utils/Logger.js';
import type { CommandContext, ICommand } from '../interfaces/ICommand.js';
import { toCommandError } from '../utils/commandErrors.js';

/**
 * !followage command
 * How long the asking viewer has followed the channel.
 */
@injectable()
export class FollowageCommand implements ICommand {
  readonly name = 'followage';
  readonly description = 'Show how long you have followed the channel';
  readonly usage = '!followage';
  readonly permissions = [PermissionLevel.VIEWER];
  /** Per-viewer, to keep a Helix-backed read off the rate limit. */
  readonly cooldown = 30;
  readonly requiredCapabilities = [PlatformCapability.FOLLOW_INFO];

  private logger: Logger;

  constructor(
    private streamControl: StreamControlService,
    logger: Logger
  ) {
    this.logger = logger.child({ command: 'followage' });
  }

  async execute(context: CommandContext): Promise<CommandResult> {
    const { user } = context;
    if (user.permissionLevel === PermissionLevel.BROADCASTER) {
      return {
        success: true,
        message: "You're literally the streamer, I can't get a follow time for yourself >:-(",
      };
    }

    try {
      const followDate = await this.streamControl
        .require(context.platform, 'followInfo')
        .getFollowDate(user.platformUserId);
      if (!followDate) {
        return {
          success: true,
          message: `@${user.username}: You are currently not following this channel`,
        };
      }
      return {
        success: true,
        message: `@${user.username} has been following for ${formatElapsed(Date.now() - followDate.getTime())}`,
        data: { followedAt: followDate.toISOString() },
      };
    } catch (error) {
      this.logger.error('Error in followage command', error);
      return toCommandError(error, 'Failed to look up the follow date');
    }
  }
}

export default FollowageCommand;
