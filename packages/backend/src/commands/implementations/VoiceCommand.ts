import type { CommandResult } from '@turingmod/shared';
import { PermissionLevel, type PlatformCapability } from '@turingmod/shared';
import { injectable } from 'tsyringe';
import { COUNTERS, CounterRepository } from '../../database/repositories/CounterRepository.js';
import type { CommandContext, ICommand } from '../interfaces/ICommand.js';
import { ok } from '../utils/results.js';

/**
 * !voice command
 * Counts the streamer's voice cracks. Anyone can add one, as in the original bot; the cooldown
 * keeps a single viewer from running the count up.
 */
@injectable()
export class VoiceCommand implements ICommand {
  readonly name = 'voice';
  readonly description = "Count a crack in the streamer's voice";
  readonly usage = '!voice';
  readonly permissions = [PermissionLevel.VIEWER];
  readonly cooldown = 30;
  readonly requiredCapabilities: PlatformCapability[] = [];

  constructor(private counters: CounterRepository) {}

  execute(_context: CommandContext): Promise<CommandResult> {
    const cracks = this.counters.increment(COUNTERS.voiceCracks);
    return Promise.resolve(ok(`Streamer's voice has cracked ${cracks} times`));
  }
}

export default VoiceCommand;
