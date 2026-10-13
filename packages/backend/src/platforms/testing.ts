import { PermissionLevel, StreamingPlatform } from '@turingmod/shared';
import type { ChatMessageEvent } from '../chat/chatMessage.js';

/**
 * Test fixture: a Twitch chat message from an ordinary viewer in pope_pontius's channel. Lives
 * outside the test files so suites can share it without importing one another.
 */
export const chatMessage = (
  message: string,
  overrides: Partial<ChatMessageEvent> = {}
): ChatMessageEvent => ({
  platform: StreamingPlatform.TWITCH,
  platformUserId: 'viewer-id',
  username: 'Viewer',
  message,
  permissionLevel: PermissionLevel.VIEWER,
  badges: [],
  timestamp: 0,
  messageId: 'message-id',
  channelId: 'channel-id',
  channelName: 'pope_pontius',
  ...overrides,
});
