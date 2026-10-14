import type { CommandResult } from '@turingmod/shared';
import { PermissionLevel, PlatformCapability } from '@turingmod/shared';
import { injectable } from 'tsyringe';
import { formatPlatformList } from '../../platforms/platformNames.js';
import { StreamControlService } from '../../platforms/StreamControlService.js';
import { Logger } from '../../utils/Logger.js';
import type { CommandContext, ICommand } from '../interfaces/ICommand.js';
import { toCommandError } from '../utils/commandErrors.js';

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
      return {
        success: false,
        message: `Usage: ${this.usage}`,
        error: {
          code: 'INVALID_INPUT',
          message: 'Title must not be empty',
        },
      };
    }

    try {
      const mirror = await this.streamControl.setTitle(newTitle);

      if (mirror.updated.length === 0) {
        const reason = mirror.failures[0]?.error ?? 'No live platforms to update';
        return {
          success: false,
          message: `Failed to update title: ${reason}`,
          error: {
            code: 'API_ERROR',
            message: reason,
          },
        };
      }

      return {
        success: true,
        message: `Title updated on ${formatPlatformList(mirror.updated)}: ${newTitle}`,
        data: { title: newTitle, updated: mirror.updated },
      };
    } catch (error) {
      this.logger.error('Error in title command', error);
      return toCommandError(error, 'Failed to update stream title');
    }
  }
}

export default TitleCommand;
