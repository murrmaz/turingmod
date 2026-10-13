import type { CommandContext, CommandResult } from '@turingmod/shared';
import { PermissionLevel, type PlatformCapability } from '@turingmod/shared';
import { injectable } from 'tsyringe';
import { LurkTracker } from '../../chat/lurk/LurkTracker.js';
import type { ICommand } from '../interfaces/ICommand.js';

/**
 * !lurk command
 * Marks the viewer as lurking, with an optional reason they'll be reminded of on their return.
 */
@injectable()
export class LurkCommand implements ICommand {
  readonly name = 'lurk';
  readonly description = 'Let chat know you are lurking';
  readonly usage = '!lurk [what you are off to do]';
  readonly permissions = [PermissionLevel.VIEWER];
  readonly cooldown = 0;
  readonly requiredCapabilities: PlatformCapability[] = [];

  constructor(private lurkers: LurkTracker) {}

  execute(context: CommandContext): Promise<CommandResult> {
    const { user } = context;
    const lurking = this.lurkers.lurk(user, context.args.slice(1).join(' '));
    return Promise.resolve({
      success: true,
      message: lurking
        ? `See you whenever you get back @${user.username}`
        : `You're already lurking @${user.username}`,
    });
  }
}

export default LurkCommand;
