import type { CommandResult } from '@turingmod/shared';
import { PermissionLevel, type PlatformCapability } from '@turingmod/shared';
import { injectable } from 'tsyringe';
import { SuggestionRepository } from '../../database/repositories/SuggestionRepository.js';
import type { CommandContext, ICommand } from '../interfaces/ICommand.js';
import { fail, ok } from '../utils/results.js';

const MAX_SUGGESTION_LENGTH = 300;

/**
 * !sg command
 * Records a viewer's suggestion for the bot.
 */
@injectable()
export class SgCommand implements ICommand {
  readonly name = 'sg';
  readonly description = 'Suggest something for the bot';
  readonly usage = '!sg <suggestion>';
  readonly permissions = [PermissionLevel.VIEWER];
  /** Per-viewer, so one viewer can't flood the list. */
  readonly cooldown = 30;
  readonly requiredCapabilities: PlatformCapability[] = [];

  constructor(private suggestions: SuggestionRepository) {}

  execute(context: CommandContext): Promise<CommandResult> {
    const user = context.user.username;
    const suggestion = context.argText;
    if (suggestion === '') {
      return Promise.resolve(
        fail(
          'INVALID_INPUT',
          `@${user}, an empty suggestion can't be written down. Usage: ${this.usage}`,
          'Empty suggestion'
        )
      );
    }
    if (suggestion.length > MAX_SUGGESTION_LENGTH) {
      return Promise.resolve(
        fail(
          'INVALID_INPUT',
          `@${user}, please keep suggestions under ${MAX_SUGGESTION_LENGTH} characters`,
          'Suggestion too long'
        )
      );
    }

    this.suggestions.add(suggestion, user);
    return Promise.resolve(ok(`@${user}, your suggestion has been written down. Thank you!`));
  }
}

export default SgCommand;
