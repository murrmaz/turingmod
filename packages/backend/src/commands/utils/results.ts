import type { CommandErrorCode, CommandResult } from '@turingmod/shared';
import { formatPlatformList } from '../../platforms/platformNames.js';
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
 * The reply to a write mirrored to every live platform (title, game, tags): a failure naming the
 * first platform's error if none took it, otherwise `describe` given the platforms that did.
 */
export function mirrorReply(
  mirror: MirrorResult,
  what: string,
  describe: (platforms: string) => string
): CommandResult {
  if (mirror.updated.length === 0) {
    const reason = mirror.failures[0]?.error ?? 'No live platforms to update';
    return fail('API_ERROR', `Failed to update ${what}: ${reason}`, reason);
  }
  return ok(describe(formatPlatformList(mirror.updated)));
}
