import type { CommandResult } from '@turingmod/shared';
import { PermissionLevel, PlatformCapability } from '@turingmod/shared';
import { injectable } from 'tsyringe';
import { StreamControlService } from '../../platforms/StreamControlService.js';
import { Logger } from '../../utils/Logger.js';
import type { CommandContext, ICommand } from '../interfaces/ICommand.js';
import { toCommandError } from '../utils/commandErrors.js';

/**
 * !delvod command
 * Deletes the most recent past broadcast — the current one while live — for when something
 * that mustn't stay up (a dox, a TOS problem) made it on stream. Irreversible, so the command
 * simulator refuses it rather than deleting a real VOD.
 */
@injectable()
export class DelvodCommand implements ICommand {
  readonly name = 'delvod';
  readonly description = 'Delete the most recent past broadcast';
  readonly usage = '!delvod';
  readonly permissions = [PermissionLevel.MODERATOR];
  readonly cooldown = 0;
  readonly requiredCapabilities = [PlatformCapability.VODS];

  private logger: Logger;

  constructor(
    private streamControl: StreamControlService,
    logger: Logger
  ) {
    this.logger = logger.child({ command: 'delvod' });
  }

  async execute(context: CommandContext): Promise<CommandResult> {
    if (context.isSimulation) {
      return {
        success: false,
        message: '!delvod deletes a real VOD, so it does not run in the simulator',
        error: { code: 'NOT_SIMULATED', message: 'Irreversible command' },
      };
    }

    try {
      const vod = await this.streamControl.require(context.platform, 'vods').deleteLatestVod();
      if (!vod) {
        return { success: true, message: 'There is no past broadcast to delete' };
      }
      this.logger.warn(
        `Deleted VOD ${vod.id} ("${vod.title}") at ${context.user.username}'s request`
      );
      return {
        success: true,
        message: 'VOD successfully deleted',
        data: { id: vod.id, title: vod.title, createdAt: vod.createdAt.toISOString() },
      };
    } catch (error) {
      this.logger.error('Error in delvod command', error);
      return toCommandError(error, 'Failed to delete the VOD');
    }
  }
}

export default DelvodCommand;
