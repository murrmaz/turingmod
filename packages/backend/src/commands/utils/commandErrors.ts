import type { CommandResult } from '@turingmod/shared';
import { messageOf } from '@turingmod/shared';
import { NotAuthenticatedError } from '../../platforms/errors.js';
import { fail } from './results.js';

/**
 * Map a thrown error into a failed CommandResult.
 *
 * Commands don't check whether a platform is authenticated — the platform façade decides that
 * and raises NotAuthenticatedError only once no automatic recovery is left. This translates that
 * one case into NOT_AUTHENTICATED, and treats everything else as an API failure described by
 * `fallbackMessage`.
 */
export function toCommandError(error: unknown, fallbackMessage: string): CommandResult {
  if (error instanceof NotAuthenticatedError) {
    return fail(
      'NOT_AUTHENTICATED',
      error.message,
      error.needsReauth ? 'Re-authorize the platform to continue' : 'Complete the OAuth flow first'
    );
  }

  return fail('API_ERROR', fallbackMessage, messageOf(error));
}
