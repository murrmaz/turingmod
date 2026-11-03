import type { CommandResult } from '@turingmod/shared';
import { PermissionLevel, type PlatformCapability } from '@turingmod/shared';
import { injectable } from 'tsyringe';
import { SoundLibrary } from '../../sounds/SoundLibrary.js';
import type { CommandContext, ICommand } from '../interfaces/ICommand.js';
import { ok } from '../utils/results.js';

/**
 * !skip command
 * Silences whatever sound is playing. Replies with nothing, as the original did.
 */
@injectable()
export class SkipCommand implements ICommand {
  readonly name = 'skip';
  readonly description = 'Stop any sound that is playing';
  readonly usage = '!skip';
  readonly permissions = [PermissionLevel.MODERATOR];
  readonly cooldown = 0;
  readonly requiredCapabilities: PlatformCapability[] = [];

  constructor(private sounds: SoundLibrary) {}

  execute(_context: CommandContext): Promise<CommandResult> {
    this.sounds.stopAll();
    return Promise.resolve(ok(''));
  }
}

export default SkipCommand;
