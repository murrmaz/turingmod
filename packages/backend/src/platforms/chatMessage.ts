import type { PermissionLevel, StreamingPlatform } from '@turingmod/shared';

/**
 * Payload of the `chat.message` EventBus event, emitted identically by every platform's chat
 * integration for every message. Commands are parsed out of it in one place (ChatRouter), after
 * moderation has had its say, rather than by each integration.
 */
export interface ChatMessageEvent {
  platform: StreamingPlatform;
  platformUserId: string;
  username: string;
  message: string;
  permissionLevel: PermissionLevel;
  badges: string[];
  timestamp: number;
  /** The platform's id for the message, which moderation needs to delete it. */
  messageId: string;
  /** The channel the message was posted in. */
  channelId: string;
  /** The channel's login name, where the platform has one (Twitch), for spotting @-mentions. */
  channelName?: string;
}

/** A `!command` and its arguments, `args[0]` being the command name as typed. */
export function parseCommand(message: string): { command: string; args: string[] } | null {
  if (!message.startsWith('!')) return null;
  const args = message.slice(1).split(' ');
  return { command: args[0] ?? '', args };
}

/**
 * Leading characters stripped from outgoing chat: whitespace and invisible format characters
 * (zero-width spaces, joiners, tag characters), which chat services may drop on delivery, and
 * the `!` and `/` command prefixes. `.` is left alone: its legacy IRC commands don't run for
 * messages sent through the platform APIs, and stripping it would mangle a leading ellipsis.
 */
const LEADING_COMMAND_PREFIX = /^[\s\p{Cf}!/]+/u;

/**
 * Make text safe for the bot to post: it can never begin with a command.
 *
 * The bot's own messages come back through chat ingest under the sending account's identity — a
 * moderator or the broadcaster — so a reply that echoed a viewer's `!delvod` would otherwise run
 * with that account's permission (a confused deputy). The same goes for other bots in the
 * channel, which would obey their commands from a moderator account. Every IStreamPlatform passes
 * outgoing chat through this, so `parseCommand()` never matches anything TuringMod sent.
 *
 * Throws if nothing is left, since a message that was only a command prefix has nothing to say.
 */
export function toSafeChatText(message: string): string {
  const safe = message.replace(LEADING_COMMAND_PREFIX, '');
  if (safe === '') {
    throw new Error('Refusing to post a chat message that is only a command prefix');
  }
  return safe;
}
