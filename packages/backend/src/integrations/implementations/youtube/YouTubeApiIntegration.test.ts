import 'reflect-metadata';
import { IntegrationStatus } from '@turingmod/shared';
import type { youtube_v3 } from 'googleapis';
import { describe, expect, it, vi } from 'vitest';
import { Logger } from '../../../utils/Logger.js';
import { YouTubeApiIntegration } from './YouTubeApiIntegration.js';
import type { YouTubeAuthIntegration, YouTubeOAuth2Client } from './YouTubeAuthIntegration.js';

async function setup() {
  const auth = {
    status: IntegrationStatus.CONNECTED,
    client: {} as YouTubeOAuth2Client | null,
    getStatus: () => auth.status,
    getAuthClient: () => auth.client,
    getGroup: () => null,
    isAuthError: vi.fn((_error: unknown) => false),
    markAuthRequired: vi.fn(),
  };
  const api = new YouTubeApiIntegration(
    new Logger({ level: 'silent' }),
    auth as unknown as YouTubeAuthIntegration
  );
  await api.start();
  return { auth, api };
}

/** getActiveBroadcast() with YouTube listing `items`. */
async function activeBroadcast(items: unknown[] | undefined) {
  const { api } = await setup();
  const list = vi.fn(() => Promise.resolve({ data: { items } }));
  vi.spyOn(api, 'request').mockImplementation((call) =>
    call({ liveBroadcasts: { list } } as unknown as youtube_v3.Youtube)
  );
  return { broadcast: await api.getActiveBroadcast(), list };
}

describe('YouTubeApiIntegration', () => {
  it('reuses its client until the auth integration replaces its own', async () => {
    const { auth, api } = await setup();
    const clients: youtube_v3.Youtube[] = [];
    const remember = (client: youtube_v3.Youtube) => {
      clients.push(client);
      return Promise.resolve();
    };

    await api.request(remember);
    await api.request(remember);
    auth.client = {} as YouTubeOAuth2Client;
    await api.request(remember);

    expect(clients[1]).toBe(clients[0]);
    expect(clients[2]).not.toBe(clients[0]);
  });

  it('fails to start on connected auth with no client to build on', async () => {
    const { auth, api } = await setup();
    await api.stop();
    auth.client = null;

    await expect(api.start()).rejects.toThrow('must be connected');
    expect(api.getStatus()).toBe(IntegrationStatus.ERROR);
  });

  it('tells the auth integration when a failed call means the grant is dead', async () => {
    const { auth, api } = await setup();
    auth.isAuthError.mockReturnValue(true);
    const failure = new Error('invalid_grant');

    await expect(api.request(() => Promise.reject(failure))).rejects.toBe(failure);

    expect(auth.markAuthRequired).toHaveBeenCalledOnce();
  });

  it('says nothing about the grant for any other failure, and still rethrows', async () => {
    const { auth, api } = await setup();
    const failure = new Error('quotaExceeded');

    await expect(api.request(() => Promise.reject(failure))).rejects.toBe(failure);

    expect(auth.markAuthRequired).not.toHaveBeenCalled();
  });

  describe('the active broadcast', () => {
    it("asks for the streamer's own, live now", async () => {
      const { list } = await activeBroadcast([]);

      expect(list).toHaveBeenCalledWith({
        part: ['snippet', 'status'],
        broadcastStatus: 'active',
        broadcastType: 'all',
        mine: true,
      });
    });

    it.each([
      ['nothing is listed', []],
      ['YouTube sends no list', undefined],
      ['the first has no id', [{ snippet: { title: 'x' } }]],
    ])('is null when %s', async (_name, items) => {
      expect((await activeBroadcast(items)).broadcast).toBeNull();
    });

    it('reads what it needs from the first listed', async () => {
      const { broadcast } = await activeBroadcast([
        {
          id: 'b1',
          snippet: {
            title: 'Live now',
            channelId: 'c1',
            liveChatId: 'chat-1',
            actualStartTime: '2026-11-02T00:00:00Z',
            scheduledStartTime: '2026-11-01T23:55:00Z',
          },
        },
        { id: 'b2' },
      ]);

      expect(broadcast).toEqual({
        id: 'b1',
        title: 'Live now',
        channelId: 'c1',
        liveChatId: 'chat-1',
        actualStartTime: '2026-11-02T00:00:00Z',
        scheduledStartTime: '2026-11-01T23:55:00Z',
      });
    });

    it('fills in what YouTube leaves out', async () => {
      const { broadcast } = await activeBroadcast([{ id: 'b1' }]);

      expect(broadcast).toEqual({
        id: 'b1',
        title: '',
        channelId: null,
        liveChatId: null,
        actualStartTime: null,
        scheduledStartTime: null,
      });
    });
  });
});
