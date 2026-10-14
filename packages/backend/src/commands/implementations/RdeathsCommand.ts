import type { CommandResult } from '@turingmod/shared';
import { PermissionLevel, type PlatformCapability } from '@turingmod/shared';
import { injectable } from 'tsyringe';
import { COUNTERS, CounterRepository } from '../../database/repositories/CounterRepository.js';
import type { CommandContext, ICommand } from '../interfaces/ICommand.js';

/**
 * !rdeaths command
 * Resets the death counter, e.g. for a new game.
 */
@injectable()
export class RdeathsCommand implements ICommand {
  readonly name = 'rdeaths';
  readonly description = 'Reset the death counter to zero';
  readonly usage = '!rdeaths';
  readonly permissions = [PermissionLevel.MODERATOR];
  readonly cooldown = 0;
  readonly requiredCapabilities: PlatformCapability[] = [];

  constructor(private counters: CounterRepository) {}

  execute(context: CommandContext): Promise<CommandResult> {
    this.counters.set(COUNTERS.deaths, 0);
    return Promise.resolve({
      success: true,
      message: `@${context.user.username}: Death count reset back to zero`,
    });
  }
}

export default RdeathsCommand;
