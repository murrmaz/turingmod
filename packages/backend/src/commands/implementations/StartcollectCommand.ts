import type { CommandResult } from '@turingmod/shared';
import { PermissionLevel, PlatformCapability } from '@turingmod/shared';
import { injectable } from 'tsyringe';
import { ClipCollector } from '../../chat/clips/ClipCollector.js';
import type { CommandContext, ICommand } from '../interfaces/ICommand.js';

/**
 * !startcollect command
 * Starts collecting the clip links posted in chat; `!endcollect` writes them out.
 */
@injectable()
export class StartcollectCommand implements ICommand {
  readonly name = 'startcollect';
  readonly description = 'Start collecting clip links from chat';
  readonly usage = '!startcollect';
  readonly permissions = [PermissionLevel.MODERATOR];
  readonly cooldown = 0;
  readonly requiredCapabilities = [PlatformCapability.CLIPS];

  constructor(private clips: ClipCollector) {}

  execute(_context: CommandContext): Promise<CommandResult> {
    return Promise.resolve({
      success: true,
      message: this.clips.begin()
        ? 'Clip collection is turned on!'
        : 'Clip collection is already on',
    });
  }
}

export default StartcollectCommand;
