import type { CommandErrorCode, CommandResult } from '@turingmod/shared';
import { formatPlatformList, platformDisplayName } from '@turingmod/shared';

import type { MirrorResult } from '../../platforms/StreamControlService.js';

/** A success, replying `message` in chat (empty to reply with nothing). */
export function ok(message: string): CommandResult {
  return { success: true, message };
}

/**
 * A failure: `message` is the reply for the viewer, `reason` what the streamer sees in the
 * activity log.
 */
export function fail(code: CommandErrorCode, message: string, reason: string): CommandResult {
  return { success: false, message, error: { code, reason } };
}

/**
 * The reply to a write mirrored to every live platform (title, game, tags): `describe` given the
 * platforms that took it, or a failure if none did. A platform's error text reaches chat only when
 * it is about the value asked for ("Game not found"); anything else is the streamer's business, so
 * chat hears only which platform failed and the error goes to the activity log as the reason.
 */
export function mirrorReply(
  mirror: MirrorResult,
  what: string,
  describe: (platforms: string) => string
): CommandResult {
  if (mirror.updated.length > 0) {
    return ok(describe(formatPlatformList(mirror.updated)));
  }
  const failure = mirror.failures[0];
  if (!failure) {
    const reason = 'No live platforms to update';
    return fail('API_ERROR', `Failed to update ${what}: ${reason}`, reason);
  }
  if (failure.invalidValue) {
    return fail('INVALID_INPUT', failure.error, failure.error);
  }
  return fail(
    'API_ERROR',
    `Failed to update ${what} on ${platformDisplayName(failure.platform)}`,
    failure.error
  );
}
