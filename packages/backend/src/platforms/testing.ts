import { PermissionLevel, StreamingPlatform } from '@turingmod/shared';
import type { ChatMessageEvent } from '../chat/chatMessage.js';
import type { CapabilityApiName, CapabilityApis } from './interfaces/IStreamPlatform.js';

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

/**
 * Test helper: a `StreamControlService.require` that hands out `apis` on `platform` and throws
 * for anything else, so asking the wrong platform fails the test. An object need only have the
 * methods the test uses.
 */
export function fakeRequire(
  platform: StreamingPlatform,
  apis: { [K in CapabilityApiName]?: Partial<CapabilityApis[K]> }
) {
  return <K extends CapabilityApiName>(
    requested: StreamingPlatform,
    name: K
  ): CapabilityApis[K] => {
    const api = apis[name] as CapabilityApis[K] | undefined;
    if (requested !== platform || !api) {
      throw new Error(`${requested} does not support ${name}`);
    }
    return api;
  };
}
