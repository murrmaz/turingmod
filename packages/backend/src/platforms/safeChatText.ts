import { LEADING_COMMAND_PREFIX } from '@turingmod/shared';

/** What ends a message cut to fit its platform's limit. */
const CUT_OFF = '…';

/**
 * Make text safe for the bot to post: it can never begin with a command, and it fits `maxLength`,
 * so a long `!lurk` reason is cut off rather than costing the whole reply.
 *
 * The bot's own messages come back through chat ingest under the sending account's identity — a
 * moderator or the broadcaster — so a reply that echoed a viewer's `!delvod` would otherwise run
 * with that account's permission (a confused deputy). The same goes for other bots in the
 * channel, which would obey their commands from a moderator account. Every IStreamPlatform passes
 * outgoing chat through this, so `parseCommand()` never matches anything TuringMod sent.
 *
 * Throws if nothing is left, since a message that was only a command prefix has nothing to say.
 */
export function toSafeChatText(message: string, maxLength: number): string {
  const safe = message.replace(LEADING_COMMAND_PREFIX, '');
  if (safe === '') {
    throw new Error('Refusing to post a chat message that is only a command prefix');
  }
  // By code point, so an emoji isn't split in half.
  const characters = Array.from(safe);
  return characters.length > maxLength
    ? characters.slice(0, maxLength - CUT_OFF.length).join('') + CUT_OFF
    : safe;
}
