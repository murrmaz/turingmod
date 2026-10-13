import 'reflect-metadata';
import { StreamingPlatform } from '@turingmod/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OwnChatMessages } from '../chat/OwnChatMessages.js';
import type { YouTubeApiIntegration } from '../integrations/implementations/youtube/YouTubeApiIntegration.js';
import type { YouTubeChatIntegration } from '../integrations/implementations/youtube/YouTubeChatIntegration.js';
import { YouTubePlatform } from './YouTubePlatform.js';

describe('YouTubePlatform', () => {
  let api: {
    getActiveBroadcast: ReturnType<typeof vi.fn>;
    sendLiveChatMessage: ReturnType<typeof vi.fn>;
  };
  let chat: { getLiveChatId: ReturnType<typeof vi.fn> };
  let ownMessages: { record: ReturnType<typeof vi.fn> };
  let platform: YouTubePlatform;

  beforeEach(() => {
    api = {
      getActiveBroadcast: vi.fn().mockResolvedValue({ id: 'b1', liveChatId: 'looked-up-chat' }),
      sendLiveChatMessage: vi.fn().mockResolvedValue('message-1'),
    };
    chat = { getLiveChatId: vi.fn().mockReturnValue(null) };
    ownMessages = {
      record: vi.fn((_platform: StreamingPlatform, send: () => Promise<string | null>) =>
        send().then(() => undefined)
      ),
    };
    platform = new YouTubePlatform(
      api as unknown as YouTubeApiIntegration,
      ownMessages as unknown as OwnChatMessages,
      chat as unknown as YouTubeChatIntegration
    );
  });

  it('posts to the streamed chat without looking up the broadcast', async () => {
    chat.getLiveChatId.mockReturnValue('streamed-chat');

    await platform.sendChatMessage('hello');

    expect(api.getActiveBroadcast).not.toHaveBeenCalled();
    expect(api.sendLiveChatMessage).toHaveBeenCalledWith('streamed-chat', 'hello');
    expect(ownMessages.record).toHaveBeenCalledWith(
      StreamingPlatform.YOUTUBE,
      expect.any(Function)
    );
  });

  it("looks up the broadcast's chat when chat isn't streaming", async () => {
    await platform.sendChatMessage('hello');

    expect(api.sendLiveChatMessage).toHaveBeenCalledWith('looked-up-chat', 'hello');
  });

  it('refuses to post when there is no live chat', async () => {
    api.getActiveBroadcast.mockResolvedValue(null);

    await expect(platform.sendChatMessage('hello')).rejects.toThrow('No active YouTube live chat');
    expect(api.sendLiveChatMessage).not.toHaveBeenCalled();
  });

  it('is live while chat is streaming, without looking up the broadcast', async () => {
    chat.getLiveChatId.mockReturnValue('streamed-chat');

    await expect(platform.isLive()).resolves.toBe(true);
    expect(api.getActiveBroadcast).not.toHaveBeenCalled();
  });

  it("asks YouTube whether it's live when chat isn't streaming", async () => {
    api.getActiveBroadcast.mockResolvedValue(null);

    await expect(platform.isLive()).resolves.toBe(false);
    expect(api.getActiveBroadcast).toHaveBeenCalledOnce();
  });
});
