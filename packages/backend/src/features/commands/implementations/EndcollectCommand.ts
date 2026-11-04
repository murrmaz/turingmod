import type { CommandResult } from '@turingmod/shared';
import { PermissionLevel, PlatformCapability } from '@turingmod/shared';
import { injectable } from 'tsyringe';
import { ClipCollector } from '../../chat/clips/ClipCollector.js';
import type { CommandContext, ICommand } from '../interfaces/ICommand.js';
import { ok } from '../utils/results.js';

/**
 * !endcollect command
 * Stops collecting clip links and writes them to a page for the streamer. The page's location
 * is on the streamer's machine, so it goes to the terminal's log, not chat.
 */
@injectable()
export class EndcollectCommand implements ICommand {
  readonly name = 'endcollect';
  readonly description = 'Stop collecting clip links and write them to file';
  readonly usage = '!endcollect';
  readonly permissions = [PermissionLevel.MODERATOR];
  readonly cooldown = 0;
  readonly requiredCapabilities = [PlatformCapability.CLIPS];
  readonly failureMessage = 'Failed to write the collected clips. Still collecting, so try again';

  constructor(private clips: ClipCollector) {}

  async execute(_context: CommandContext): Promise<CommandResult> {
    const result = await this.clips.end();
    if (!result) {
      return ok('Clip collection is not on');
    }
    return ok(`All collected clips are written to file! (${result.count})`);
  }
}

export default EndcollectCommand;
