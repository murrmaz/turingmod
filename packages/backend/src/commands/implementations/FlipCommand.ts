import type { CommandResult } from '@turingmod/shared';
import { PermissionLevel, type PlatformCapability } from '@turingmod/shared';
import { injectable } from 'tsyringe';
import type { CommandContext, ICommand } from '../interfaces/ICommand.js';

/**
 * !flip command
 * Flips a coin.
 */
@injectable()
export class FlipCommand implements ICommand {
  readonly name = 'flip';
  readonly description = 'Flip a coin';
  readonly usage = '!flip';
  readonly permissions = [PermissionLevel.VIEWER];
  readonly cooldown = 0;
  readonly requiredCapabilities: PlatformCapability[] = [];

  execute(context: CommandContext): Promise<CommandResult> {
    const side = Math.random() < 0.5 ? 'Heads' : 'Tails';
    return Promise.resolve({ success: true, message: `@${context.user.username}: ${side}` });
  }
}

export default FlipCommand;
