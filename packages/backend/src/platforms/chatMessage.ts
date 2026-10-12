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
