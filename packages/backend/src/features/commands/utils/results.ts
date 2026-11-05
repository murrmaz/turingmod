import type { CommandErrorCode, CommandResult } from '@turingmod/shared';
import { formatPlatformList, platformDisplayName } from '@turingmod/shared';

import type { MirrorResult } from '../../../platforms/StreamControlService.js';

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
 * chat hears only which platforms failed and the errors go to the activity log as the reason. A
 * platform that couldn't be tried is the streamer's business too: chat hears nothing about it.
 *
 * A write some platform took is a success whatever the others did, and `mirror()` reports those
 * that failed, since a success carries no reason.
 */
export function mirrorReply(
  mirror: MirrorResult,
  what: string,
  describe: (platforms: string) => string
): CommandResult {
  if (mirror.updated.length > 0) {
    return ok(describe(formatPlatformList(mirror.updated)));
  }
  const reasons = [
    ...mirror.failures.map(({ platform, error }) => `${platformDisplayName(platform)}: ${error}`),
    ...mirror.skipped.map(({ platform, reason }) => `${platformDisplayName(platform)}: ${reason}`),
  ];
  if (reasons.length === 0) {
    const reason = 'No live platforms to update';
    return fail('API_ERROR', `Failed to update ${what}: ${reason}`, reason);
  }
  const reason = reasons.join('; ');
  const invalid = mirror.failures.find((failure) => failure.invalidValue);
  if (invalid) {
    return fail('INVALID_INPUT', invalid.error, reason);
  }
  if (mirror.failures.length === 0) {
    return fail('API_ERROR', `Failed to update ${what}`, reason);
  }
  const failed = formatPlatformList(mirror.failures.map(({ platform }) => platform));
  return fail('API_ERROR', `Failed to update ${what} on ${failed}`, reason);
}
