import { z } from 'zod';
import { StreamingPlatform } from '../constants/platform.js';

/**
 * The most characters (code points) each platform's chat takes in one message. Twitch's limit
 * covers announcements too. YouTube's chat box takes 200, but its API documents no limit, only
 * that it can refuse a message as `messageTextInvalid`, so this is the safe side of what isn't
 * written down.
 */
export const CHAT_MESSAGE_LIMITS: Readonly<Record<StreamingPlatform, number>> = {
  [StreamingPlatform.TWITCH]: 500,
  [StreamingPlatform.YOUTUBE]: 200,
};

/**
 * Leading characters stripped from outgoing chat: whitespace and invisible format characters
 * (zero-width spaces, joiners, tag characters), which chat services may drop on delivery, and
 * the `!` and `/` command prefixes. `.` is left alone: its legacy IRC commands don't run for
 * messages sent through the platform APIs, and stripping it would mangle a leading ellipsis.
 */
export const LEADING_COMMAND_PREFIX = /^[\s\p{Cf}!/]+/u;

/** How often an interval message is posted, as in the original bot. */
export const ANNOUNCEMENT_INTERVAL_MS = 30 * 60 * 1000;

/**
 * The text of an interval message. Past the longest limit, every platform would cut it off. A
 * leading command prefix is refused rather than left for `toSafeChatText()` to strip, and a line
 * break rather than left for the platform to deal with, so what's saved is what's posted.
 */
export const IntervalMessageTextSchema = z
  .string()
  .trim()
  .min(1, 'Write something to post')
  .refine((text) => Array.from(text).length <= CHAT_MESSAGE_LIMITS[StreamingPlatform.TWITCH], {
    error: `At most ${CHAT_MESSAGE_LIMITS[StreamingPlatform.TWITCH]} characters`,
  })
  .refine((text) => !LEADING_COMMAND_PREFIX.test(text), {
    error: "Can't start with ! or /, which chat would treat as a command",
  })
  .refine((text) => !/[\r\n]/.test(text), { error: 'A chat message is a single line' });
