import type { CommandContext, CommandResult } from '@turingmod/shared';
import { PermissionLevel, type PlatformCapability } from '@turingmod/shared';
import { injectable } from 'tsyringe';
import { COUNTERS, CounterRepository } from '../../database/repositories/CounterRepository.js';
import type { ICommand } from '../interfaces/ICommand.js';

/**
 * !died command
 * Adds one to the death counter.
 */
@injectable()
export class DiedCommand implements ICommand {
  readonly name = 'died';
  readonly description = 'Add one to the death counter';
  readonly usage = '!died';
  readonly permissions = [PermissionLevel.MODERATOR];
  readonly cooldown = 0;
  readonly requiredCapabilities: PlatformCapability[] = [];

  constructor(private counters: CounterRepository) {}

  async execute(_context: CommandContext): Promise<CommandResult> {
    const deaths = await this.counters.increment(COUNTERS.deaths);
    return { success: true, message: `Death count: ${deaths}`, data: { deaths } };
  }
}

export default DiedCommand;
