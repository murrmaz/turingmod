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
    request: ReturnType<typeof vi.fn>;
  };
  // The slice of the googleapis client these tests touch; request() runs each call against it.
  let youtube: {
    liveChatMessages: { insert: ReturnType<typeof vi.fn> };
    liveBroadcasts: { update: ReturnType<typeof vi.fn> };
  };
  let chat: { getLiveChatId: ReturnType<typeof vi.fn> };
  let ownMessages: { record: ReturnType<typeof vi.fn> };
  let platform: YouTubePlatform;

  beforeEach(() => {
    youtube = {
      liveChatMessages: { insert: vi.fn().mockResolvedValue({ data: { id: 'message-1' } }) },
      liveBroadcasts: { update: vi.fn().mockResolvedValue({}) },
    };
    api = {
      getActiveBroadcast: vi.fn().mockResolvedValue({ id: 'b1', liveChatId: 'looked-up-chat' }),
      request: vi.fn((call: (client: typeof youtube) => Promise<unknown>) => call(youtube)),
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

  /** Where the one message posted went, and what it said. */
  function sentTo() {
    const [params] = youtube.liveChatMessages.insert.mock.calls[0] ?? [];
    const snippet = params?.requestBody?.snippet;
    return { liveChatId: snippet?.liveChatId, text: snippet?.textMessageDetails?.messageText };
  }

  it('posts to the streamed chat without looking up the broadcast', async () => {
    chat.getLiveChatId.mockReturnValue('streamed-chat');

    await platform.sendChatMessage('hello');

    expect(api.getActiveBroadcast).not.toHaveBeenCalled();
    expect(sentTo()).toEqual({ liveChatId: 'streamed-chat', text: 'hello' });
    expect(ownMessages.record).toHaveBeenCalledWith(
      StreamingPlatform.YOUTUBE,
      expect.any(Function)
    );
  });

  it("looks up the broadcast's chat when chat isn't streaming", async () => {
    await platform.sendChatMessage('hello');

    expect(sentTo()).toEqual({ liveChatId: 'looked-up-chat', text: 'hello' });
  });

  it('refuses to post when there is no live chat', async () => {
    api.getActiveBroadcast.mockResolvedValue(null);

    await expect(platform.sendChatMessage('hello')).rejects.toThrow('No active YouTube live chat');
    expect(youtube.liveChatMessages.insert).not.toHaveBeenCalled();
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

  it('renames the broadcast, keeping its scheduled start time', async () => {
    api.getActiveBroadcast.mockResolvedValue({ id: 'b1', scheduledStartTime: '2026-10-14T18:00Z' });

    await platform.setStreamInfo({ title: 'New title' });

    expect(youtube.liveBroadcasts.update).toHaveBeenCalledWith({
      part: ['snippet'],
      requestBody: {
        id: 'b1',
        snippet: { title: 'New title', scheduledStartTime: '2026-10-14T18:00Z' },
      },
    });
  });
});
