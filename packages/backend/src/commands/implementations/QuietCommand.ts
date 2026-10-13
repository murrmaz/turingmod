import type { CommandContext, CommandResult } from '@turingmod/shared';
import { PermissionLevel, PlatformCapability } from '@turingmod/shared';
import { injectable } from 'tsyringe';
import { ChatModerator } from '../../chat/moderation/ChatModerator.js';
import type { ICommand } from '../interfaces/ICommand.js';

/**
 * !quiet command
 * Toggles quiet mode, in which messages @-mentioning the streamer are deleted.
 */
@injectable()
export class QuietCommand implements ICommand {
  readonly name = 'quiet';
  readonly description = 'Toggle quiet mode (no @-ing the streamer)';
  readonly usage = '!quiet';
  readonly permissions = [PermissionLevel.MODERATOR];
  readonly cooldown = 0;
  // Quiet mode is enforced by moderation, so it only means something where that exists.
  readonly requiredCapabilities = [PlatformCapability.MODERATION];

  constructor(private moderator: ChatModerator) {}

  execute(context: CommandContext): Promise<CommandResult> {
    const enabled = !this.moderator.isQuietMode();
    this.moderator.setQuietMode(enabled);
    const user = context.user.username;
    return Promise.resolve({
      success: true,
      message: enabled
        ? `@${user}: Quiet mode has been enabled. All messages @-ing the streamer will be removed until turned off`
        : `@${user}: Quiet mode has been disabled. Feel free to @ the streamer`,
      data: { quietMode: enabled },
    });
  }
}

export default QuietCommand;
