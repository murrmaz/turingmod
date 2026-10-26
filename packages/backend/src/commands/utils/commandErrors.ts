import type { CommandResult } from '@turingmod/shared';
import { messageOf } from '@turingmod/shared';
import { InvalidStreamInfoError, NotAuthenticatedError } from '../../platforms/errors.js';
import { fail } from './results.js';

/**
 * Map a thrown error into a failed CommandResult.
 *
 * Commands don't check whether a platform is authenticated — the platform façade decides that
 * and raises NotAuthenticatedError only once no automatic recovery is left. This translates that
 * one case into NOT_AUTHENTICATED. An InvalidStreamInfoError is the asker's mistake and is written
 * for them, so it becomes INVALID_INPUT with its own message. Everything else is an API failure
 * described by `fallbackMessage`, its error kept out of chat.
 */
export function toCommandError(error: unknown, fallbackMessage: string): CommandResult {
  if (error instanceof NotAuthenticatedError) {
    return fail(
      'NOT_AUTHENTICATED',
      error.message,
      error.needsReauth ? 'Re-authorize the platform to continue' : 'Complete the OAuth flow first'
    );
  }

  if (error instanceof InvalidStreamInfoError) {
    return fail('INVALID_INPUT', error.message, error.message);
  }

  return fail('API_ERROR', fallbackMessage, messageOf(error));
}
