import type { CommandContext, CommandResult } from '@turingmod/shared';
import { PermissionLevel, PlatformCapability } from '@turingmod/shared';
import { injectable } from 'tsyringe';
import { ClipCollector } from '../../clips/ClipCollector.js';
import { Logger } from '../../utils/Logger.js';
import type { ICommand } from '../interfaces/ICommand.js';
import { toCommandError } from '../utils/commandErrors.js';

/**
 * !endcollect command
 * Stops collecting clip links and writes them to a page for the streamer. The page's location
 * is on the streamer's machine, so it goes to the log and the console, not chat.
 */
@injectable()
export class EndcollectCommand implements ICommand {
  readonly name = 'endcollect';
  readonly description = 'Stop collecting clip links and write them to file';
  readonly usage = '!endcollect';
  readonly permissions = [PermissionLevel.MODERATOR];
  readonly cooldown = 0;
  readonly requiredCapabilities = [PlatformCapability.CLIPS];

  private logger: Logger;

  constructor(
    private clips: ClipCollector,
    logger: Logger
  ) {
    this.logger = logger.child({ command: 'endcollect' });
  }

  async execute(_context: CommandContext): Promise<CommandResult> {
    try {
      const result = await this.clips.end();
      if (!result) {
        return { success: true, message: 'Clip collection is not on' };
      }
      return {
        success: true,
        message: `All collected clips are written to file! (${result.count})`,
        data: result,
      };
    } catch (error) {
      this.logger.error('Error in endcollect command', error);
      return toCommandError(error, 'Failed to write the collected clips');
    }
  }
}

export default EndcollectCommand;
