import type { CommandResult } from '@turingmod/shared';
import { PermissionLevel, PlatformCapability } from '@turingmod/shared';
import { injectable } from 'tsyringe';
import { StreamControlService } from '../../../platforms/StreamControlService.js';
import { formatElapsed } from '../../../utils/FormatHelpers.js';
import type { CommandContext, ICommand } from '../interfaces/ICommand.js';
import { ok } from '../utils/results.js';

/**
 * !accountage command
 * How old the asking viewer's account is.
 */
@injectable()
export default class AccountageCommand implements ICommand {
  readonly name = 'accountage';
  readonly description = 'Show how old your account is';
  readonly usage = '!accountage';
  readonly permissions = [PermissionLevel.VIEWER];
  /** Per-viewer, to keep a Helix-backed read off the rate limit. */
  readonly cooldown = 30;
  readonly requiredCapabilities = [PlatformCapability.ACCOUNT_AGE];
  readonly failureMessage = 'Failed to look up the account';

  constructor(private streamControl: StreamControlService) {}

  async execute(context: CommandContext): Promise<CommandResult> {
    const { user } = context;
    const createdAt = await this.streamControl
      .require(context.platform, 'accountAge')
      .getAccountCreatedAt(user.platformUserId);
    if (!createdAt) {
      return ok(`@${user.username}, I couldn't find your account`);
    }
    return ok(
      `@${user.username}, your account is ${formatElapsed(Date.now() - createdAt.getTime())} old`
    );
  }
}
