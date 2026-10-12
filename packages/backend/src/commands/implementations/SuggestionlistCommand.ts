import type { CommandContext, CommandResult } from '@turingmod/shared';
import { PermissionLevel, type PlatformCapability } from '@turingmod/shared';
import { injectable } from 'tsyringe';
import { SuggestionRepository } from '../../database/repositories/SuggestionRepository.js';
import type { ICommand } from '../interfaces/ICommand.js';

const SHOWN = 5;

/**
 * !suggestionlist command
 * The latest suggestions for the bot. (The original showed the first five lines of its file,
 * which the streamer pruned by hand; with no pruning here, the latest are the useful ones.)
 */
@injectable()
export class SuggestionlistCommand implements ICommand {
  readonly name = 'suggestionlist';
  readonly description = 'Show the latest suggestions for the bot';
  readonly usage = '!suggestionlist';
  readonly permissions = [PermissionLevel.VIEWER];
  readonly cooldown = 30;
  readonly requiredCapabilities: PlatformCapability[] = [];

  constructor(private suggestions: SuggestionRepository) {}

  async execute(_context: CommandContext): Promise<CommandResult> {
    const latest = await this.suggestions.latest(SHOWN);
    if (latest.length === 0) {
      return { success: true, message: 'No suggestions yet. Make one with !sg' };
    }
    return {
      success: true,
      message: `Latest suggestions for the bot: ${latest.map((s) => s.suggestion).join('; ')}`,
    };
  }
}

export default SuggestionlistCommand;
