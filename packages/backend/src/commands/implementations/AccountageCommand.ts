import type { CommandContext, CommandResult } from '@turingmod/shared';
import { PermissionLevel, PlatformCapability } from '@turingmod/shared';
import { injectable } from 'tsyringe';
import { StreamControlService } from '../../platforms/StreamControlService.js';
import { formatElapsed } from '../../utils/FormatHelpers.js';
import { Logger } from '../../utils/Logger.js';
import type { ICommand } from '../interfaces/ICommand.js';
import { toCommandError } from '../utils/commandErrors.js';

/**
 * !accountage command
 * How old the asking viewer's account is.
 */
@injectable()
export class AccountageCommand implements ICommand {
  readonly name = 'accountage';
  readonly description = 'Show how old your account is';
  readonly usage = '!accountage';
  readonly permissions = [PermissionLevel.VIEWER];
  /** Per-viewer, to keep a Helix-backed read off the rate limit. */
  readonly cooldown = 30;
  readonly requiredCapabilities = [PlatformCapability.ACCOUNT_AGE];

  private logger: Logger;

  constructor(
    private streamControl: StreamControlService,
    logger: Logger
  ) {
    this.logger = logger.child({ command: 'accountage' });
  }

  async execute(context: CommandContext): Promise<CommandResult> {
    const { user } = context;
    try {
      const createdAt = await this.streamControl.getAccountCreatedAt(
        context.platform,
        user.platformUserId
      );
      if (!createdAt) {
        return { success: true, message: `@${user.username}, I couldn't find your account` };
      }
      return {
        success: true,
        message: `@${user.username}, your account is ${formatElapsed(Date.now() - createdAt.getTime())} old`,
        data: { createdAt: createdAt.toISOString() },
      };
    } catch (error) {
      this.logger.error('Error in accountage command', error);
      return toCommandError(error, 'Failed to look up the account');
    }
  }
}

export default AccountageCommand;
