import 'reflect-metadata';
import { StreamingPlatform } from '@turingmod/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OwnChatMessages } from '../chat/OwnChatMessages.js';
import type { YouTubeApiIntegration } from '../integrations/implementations/youtube/YouTubeApiIntegration.js';
import type { YouTubeChatIntegration } from '../integrations/implementations/youtube/YouTubeChatIntegration.js';
import { YouTubePlatform } from './YouTubePlatform.js';

/** The broadcast chat is streaming, as YouTubeChatIntegration.getBroadcast() reports it. */
const STREAMED = {
  id: 'streamed-broadcast',
  channelId: 'UC_broadcaster',
  liveChatId: 'streamed-chat',
  actualStartTime: '2026-10-14T18:00:00Z',
  scheduledStartTime: '2026-10-14T17:55:00Z',
};

describe('YouTubePlatform', () => {
  let api: {
    getActiveBroadcast: ReturnType<typeof vi.fn>;
    request: ReturnType<typeof vi.fn>;
  };
  // The slice of the googleapis client these tests touch; request() runs each call against it.
  let youtube: {
    liveChatMessages: { insert: ReturnType<typeof vi.fn> };
    liveBroadcasts: { list: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  };
  let chat: { getBroadcast: ReturnType<typeof vi.fn> };
  let ownMessages: { record: ReturnType<typeof vi.fn> };
  let platform: YouTubePlatform;

  beforeEach(() => {
    youtube = {
      liveChatMessages: { insert: vi.fn().mockResolvedValue({ data: { id: 'message-1' } }) },
      liveBroadcasts: {
        // The broadcast's snippet as YouTube has it, read before each rename.
        list: vi.fn().mockResolvedValue({
          data: { items: [{ snippet: { scheduledStartTime: '2026-10-14T17:55:00Z' } }] },
        }),
        update: vi.fn().mockResolvedValue({}),
      },
    };
    api = {
      getActiveBroadcast: vi.fn().mockResolvedValue({ id: 'b1', liveChatId: 'looked-up-chat' }),
      request: vi.fn((call: (client: typeof youtube) => Promise<unknown>) => call(youtube)),
    };
    chat = { getBroadcast: vi.fn().mockReturnValue(null) };
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

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Where the one message posted went, and what it said. */
  function sentTo() {
    const [params] = youtube.liveChatMessages.insert.mock.calls[0] ?? [];
    const snippet = params?.requestBody?.snippet;
    return { liveChatId: snippet?.liveChatId, text: snippet?.textMessageDetails?.messageText };
  }

  it('posts to the streamed chat without looking up the broadcast', async () => {
    chat.getBroadcast.mockReturnValue(STREAMED);

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
    chat.getBroadcast.mockReturnValue(STREAMED);

    await expect(platform.isLive()).resolves.toBe(true);
    expect(api.getActiveBroadcast).not.toHaveBeenCalled();
  });

  it("asks YouTube whether it's live when chat isn't streaming", async () => {
    api.getActiveBroadcast.mockResolvedValue(null);

    await expect(platform.isLive()).resolves.toBe(false);
    expect(api.getActiveBroadcast).toHaveBeenCalledOnce();
  });

  it("renames the broadcast, keeping the snippet's other fields, which an update would erase", async () => {
    youtube.liveBroadcasts.list.mockResolvedValue({
      data: {
        items: [
          {
            snippet: {
              title: 'Old title',
              description: 'Playing through the DLC',
              scheduledStartTime: '2026-10-14T18:00Z',
              scheduledEndTime: '2026-10-14T21:00Z',
              channelId: 'UC_broadcaster',
            },
          },
        ],
      },
    });

    await platform.setStreamInfo({ title: 'New title' });

    expect(youtube.liveBroadcasts.list).toHaveBeenCalledWith({ part: ['snippet'], id: ['b1'] });
    expect(youtube.liveBroadcasts.update).toHaveBeenCalledWith({
      part: ['snippet'],
      requestBody: {
        id: 'b1',
        snippet: {
          title: 'New title',
          description: 'Playing through the DLC',
          scheduledStartTime: '2026-10-14T18:00Z',
          scheduledEndTime: '2026-10-14T21:00Z',
        },
      },
    });
  });

  it('renames the streamed broadcast without looking for the active one', async () => {
    chat.getBroadcast.mockReturnValue(STREAMED);

    await platform.setStreamInfo({ title: 'New title' });

    expect(api.getActiveBroadcast).not.toHaveBeenCalled();
    expect(youtube.liveBroadcasts.list).toHaveBeenCalledWith({
      part: ['snippet'],
      id: ['streamed-broadcast'],
    });
    expect(youtube.liveBroadcasts.update).toHaveBeenCalledWith({
      part: ['snippet'],
      requestBody: {
        id: 'streamed-broadcast',
        snippet: { title: 'New title', scheduledStartTime: '2026-10-14T17:55:00Z' },
      },
    });
  });

  it('refuses to rename a broadcast YouTube no longer has', async () => {
    youtube.liveBroadcasts.list.mockResolvedValue({ data: { items: [] } });

    await expect(platform.setStreamInfo({ title: 'New title' })).rejects.toThrow(
      'no longer exists'
    );
    expect(youtube.liveBroadcasts.update).not.toHaveBeenCalled();
  });

  it("reports the streamed broadcast's uptime without looking it up", async () => {
    vi.useFakeTimers({ now: new Date('2026-10-14T19:00:00Z') });
    chat.getBroadcast.mockReturnValue(STREAMED);

    await expect(platform.getUptime()).resolves.toBe(60 * 60 * 1000);
    expect(api.getActiveBroadcast).not.toHaveBeenCalled();
  });

  it('reads the title afresh even while chat is streaming, since it can change', async () => {
    chat.getBroadcast.mockReturnValue(STREAMED);
    api.getActiveBroadcast.mockResolvedValue({ id: 'streamed-broadcast', title: 'Renamed' });

    await expect(platform.getStreamInfo()).resolves.toEqual({ title: 'Renamed' });
    expect(api.getActiveBroadcast).toHaveBeenCalledOnce();
  });
});
