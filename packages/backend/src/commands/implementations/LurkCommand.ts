import type { CommandResult } from '@turingmod/shared';
import { PermissionLevel, type PlatformCapability } from '@turingmod/shared';
import { injectable } from 'tsyringe';
import { LurkTracker } from '../../chat/lurk/LurkTracker.js';
import type { CommandContext, ICommand } from '../interfaces/ICommand.js';
import { ok } from '../utils/results.js';

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
    const lurking = this.lurkers.lurk(user, context.argText);
    return Promise.resolve(
      ok(
        lurking
          ? `See you whenever you get back @${user.username}`
          : `You're already lurking @${user.username}`
      )
    );
  }
}

export default LurkCommand;
