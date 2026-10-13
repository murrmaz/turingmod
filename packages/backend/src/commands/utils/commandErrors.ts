import type { CommandResult } from '@turingmod/shared';
import { NotAuthenticatedError } from '../../platforms/errors.js';

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
    return {
      success: false,
      message: error.message,
      error: {
        code: 'NOT_AUTHENTICATED',
        message: error.needsReauth
          ? 'Re-authorize the platform to continue'
          : 'Complete the OAuth flow first',
      },
    };
  }

  return {
    success: false,
    message: fallbackMessage,
    error: {
      code: 'API_ERROR',
      message: error instanceof Error ? error.message : 'Unknown error',
    },
  };
}
