import type { CommandResult } from '@turingmod/shared';
import { PermissionLevel, PlatformCapability } from '@turingmod/shared';
import { injectable } from 'tsyringe';
import { StreamControlService } from '../../platforms/StreamControlService.js';
import { Logger } from '../../utils/Logger.js';
import type { CommandContext, ICommand } from '../interfaces/ICommand.js';
import { toCommandError } from '../utils/commandErrors.js';
import { fail, mirrorReply } from '../utils/results.js';

/**
 * !title command
 * Sets the stream title, mirroring to every live platform that supports SET_TITLE.
 *
 * Write-only by design. A read mode would have to answer "what is the title?" with a single
 * string while each platform holds its own — and a partially-applied mirror (Twitch updated,
 * YouTube refused) makes that answer actively misleading. Viewers can already see the title on
 * the stream page, so the read side was redundant for most of chat and incoherent for the rest.
 */
@injectable()
export class TitleCommand implements ICommand {
  readonly name = 'title';
  readonly description = 'Set the stream title';
  readonly usage = '!title <new title>';
  readonly permissions = [PermissionLevel.MODERATOR];
  /** No cooldown needed: write-only and moderator-only, and moderators are exempt anyway. */
  readonly cooldown = 0;
  readonly requiredCapabilities = [PlatformCapability.SET_TITLE];

  private logger: Logger;

  constructor(
    private streamControl: StreamControlService,
    logger: Logger
  ) {
    this.logger = logger.child({ command: 'title' });
  }

  async execute(context: CommandContext): Promise<CommandResult> {
    // No inner permission check: the command has no viewer-readable branch left, so
    // CommandExecutor's top-level gate on `permissions` already rejects non-moderators.
    const newTitle = context.argText;

    if (newTitle === '') {
      return fail('INVALID_INPUT', `Usage: ${this.usage}`, 'Title must not be empty');
    }

    try {
      const mirror = await this.streamControl.setTitle(newTitle);
      return mirrorReply(
        mirror,
        'title',
        (platforms) => `Title updated on ${platforms}: ${newTitle}`
      );
    } catch (error) {
      this.logger.error('Error in title command', error);
      return toCommandError(error, 'Failed to update stream title');
    }
  }
}

export default TitleCommand;
