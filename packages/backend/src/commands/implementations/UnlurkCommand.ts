import type { CommandContext, CommandResult } from '@turingmod/shared';
import { PermissionLevel, type PlatformCapability } from '@turingmod/shared';
import { injectable } from 'tsyringe';
import { LurkTracker, welcomeBackMessage } from '../../lurk/LurkTracker.js';
import type { ICommand } from '../interfaces/ICommand.js';

/**
 * !unlurk command
 * Ends a lurk, saying how long the viewer was gone. (Chatting again does the same.)
 */
@injectable()
export class UnlurkCommand implements ICommand {
  readonly name = 'unlurk';
  readonly description = 'Stop lurking';
  readonly usage = '!unlurk';
  readonly permissions = [PermissionLevel.VIEWER];
  readonly cooldown = 0;
  readonly requiredCapabilities: PlatformCapability[] = [];

  constructor(private lurkers: LurkTracker) {}

  execute(context: CommandContext): Promise<CommandResult> {
    const { user } = context;
    const lurker = this.lurkers.unlurk(user);
    return Promise.resolve({
      success: true,
      message: lurker
        ? welcomeBackMessage(user.username, lurker)
        : `You needed to be lurking already in order to stop lurking @${user.username}`,
    });
  }
}

export default UnlurkCommand;
