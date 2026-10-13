import type { CommandContext, CommandResult } from '@turingmod/shared';
import { PermissionLevel, type PlatformCapability } from '@turingmod/shared';
import { injectable } from 'tsyringe';
import { LurkTracker } from '../../chat/lurk/LurkTracker.js';
import type { ICommand } from '../interfaces/ICommand.js';

/**
 * !leave command
 * Says goodbye for a viewer heading out, lurking or not, and ends any lurk.
 */
@injectable()
export class LeaveCommand implements ICommand {
  readonly name = 'leave';
  readonly description = 'Let chat know you are heading out';
  readonly usage = '!leave';
  readonly permissions = [PermissionLevel.VIEWER];
  readonly cooldown = 0;
  readonly requiredCapabilities: PlatformCapability[] = [];

  constructor(private lurkers: LurkTracker) {}

  execute(context: CommandContext): Promise<CommandResult> {
    this.lurkers.unlurk(context.user);
    return Promise.resolve({
      success: true,
      message: `Goodbye for now @${context.user.username}! See you later!`,
    });
  }
}

export default LeaveCommand;
