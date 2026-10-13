import 'reflect-metadata';
import { IntegrationStatus, StreamingPlatform } from '@turingmod/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OwnChatMessages } from '../chat/OwnChatMessages.js';
import type { TwitchApiIntegration } from '../integrations/implementations/twitch/TwitchApiIntegration.js';
import type { TwitchAuthIntegration } from '../integrations/implementations/twitch/TwitchAuthIntegration.js';
import { NotAuthenticatedError } from './errors.js';
import { TwitchPlatform } from './TwitchPlatform.js';

const BROADCASTER = 'broadcaster-id';

function setup() {
  let status = IntegrationStatus.CONNECTED;
  const auth = {
    getStatus: () => status,
    getErrorMessage: () => undefined,
    getAuthenticatedUserId: () => BROADCASTER,
  };
  const api = {
    getAdSchedule: vi.fn(),
    snoozeNextAd: vi.fn(),
    getChannelFollowers: vi.fn(),
    getUserById: vi.fn(),
    getStream: vi.fn(),
    createStreamMarker: vi.fn(),
    getVideosByUser: vi.fn(),
    deleteVideos: vi.fn(() => Promise.resolve()),
    sendAnnouncement: vi.fn(() => Promise.resolve()),
    sendChatMessage: vi.fn(() => Promise.resolve({ id: 'sent-id', isSent: true })),
  };
  const ownMessages = {
    record: vi.fn((_platform: unknown, send: () => Promise<string | null>) =>
      send().then(() => undefined)
    ),
  };
  const platform = new TwitchPlatform(
    auth as unknown as TwitchAuthIntegration,
    api as unknown as TwitchApiIntegration,
    ownMessages as unknown as OwnChatMessages
  );
  return {
    api,
    ownMessages,
    platform,
    disconnect: () => {
      status = IntegrationStatus.DISCONNECTED;
    },
  };
}

describe('TwitchPlatform', () => {
  let api: ReturnType<typeof setup>['api'];
  let platform: TwitchPlatform;

  beforeEach(() => {
    ({ api, platform } = setup());
  });

  describe('snoozeNextAd', () => {
    it('snoozes when a snooze is left', async () => {
      const nextAdDate = new Date(1000);
      api.getAdSchedule.mockResolvedValue({ snoozeCount: 2, nextAdDate: new Date(0) });
      api.snoozeNextAd.mockResolvedValue({ snoozeCount: 1, nextAdDate });

      expect(await platform.ads.snoozeNextAd()).toEqual({
        snoozed: true,
        snoozesLeft: 1,
        nextAdDate,
      });
    });

    it('reports, rather than attempts, a snooze with none left', async () => {
      const nextAdDate = new Date(0);
      api.getAdSchedule.mockResolvedValue({ snoozeCount: 0, nextAdDate });

      expect(await platform.ads.snoozeNextAd()).toEqual({
        snoozed: false,
        snoozesLeft: 0,
        nextAdDate,
      });
      expect(api.snoozeNextAd).not.toHaveBeenCalled();
    });
  });

  it('reads a follow date, or null for a non-follower', async () => {
    const followDate = new Date(5000);
    api.getChannelFollowers.mockResolvedValueOnce({ data: [{ followDate }] });
    api.getChannelFollowers.mockResolvedValueOnce({ data: [] });

    expect(await platform.followInfo.getFollowDate('viewer')).toBe(followDate);
    expect(await platform.followInfo.getFollowDate('stranger')).toBeNull();
    expect(api.getChannelFollowers).toHaveBeenCalledWith(BROADCASTER, 'viewer');
  });

  it("reads an account's creation date", async () => {
    const creationDate = new Date(7000);
    api.getUserById.mockResolvedValue({ creationDate });

    expect(await platform.accountAge.getAccountCreatedAt('viewer')).toBe(creationDate);
  });

  describe('createStreamMarker', () => {
    it('marks the live broadcast', async () => {
      api.getStream.mockResolvedValue({});
      api.createStreamMarker.mockResolvedValue({ positionInSeconds: 754, description: 'clip' });

      expect(await platform.markers.createStreamMarker('clip')).toEqual({
        positionSeconds: 754,
        description: 'clip',
      });
      expect(api.createStreamMarker).toHaveBeenCalledWith(BROADCASTER, 'clip');
    });

    it('explains that markers need a live broadcast', async () => {
      api.getStream.mockResolvedValue(null);

      await expect(platform.markers.createStreamMarker()).rejects.toThrow(
        'Stream markers can only be created while live'
      );
      expect(api.createStreamMarker).not.toHaveBeenCalled();
    });
  });

  describe('deleteLatestVod', () => {
    it('deletes the most recent past broadcast', async () => {
      const createdAt = new Date(9000);
      api.getVideosByUser.mockResolvedValue({
        data: [{ id: 'v1', title: 'Last stream', url: 'https://x/v1', creationDate: createdAt }],
      });

      expect(await platform.vods.deleteLatestVod()).toEqual({
        id: 'v1',
        title: 'Last stream',
        url: 'https://x/v1',
        createdAt,
      });
      expect(api.getVideosByUser).toHaveBeenCalledWith(BROADCASTER, { type: 'archive', limit: 1 });
      expect(api.deleteVideos).toHaveBeenCalledWith(BROADCASTER, ['v1']);
    });

    it('deletes nothing when there is no past broadcast', async () => {
      api.getVideosByUser.mockResolvedValue({ data: [] });

      expect(await platform.vods.deleteLatestVod()).toBeNull();
      expect(api.deleteVideos).not.toHaveBeenCalled();
    });
  });

  it('posts an announcement', async () => {
    await platform.announcements.sendAnnouncement('Follow me');

    expect(api.sendAnnouncement).toHaveBeenCalledWith(BROADCASTER, 'Follow me');
  });

  it('never posts a chat message or announcement that starts with a command', async () => {
    await platform.sendChatMessage('!delvod');
    await platform.announcements.sendAnnouncement('/ban someone');

    expect(api.sendChatMessage).toHaveBeenCalledWith(BROADCASTER, 'delvod');
    expect(api.sendAnnouncement).toHaveBeenCalledWith(BROADCASTER, 'ban someone');
  });

  it("records the sent message's id, or nothing when Twitch dropped it", async () => {
    const { platform, api, ownMessages } = setup();
    const recorded: (string | null)[] = [];
    ownMessages.record.mockImplementation(async (_platform, send) => {
      recorded.push(await send());
    });

    await platform.sendChatMessage('hello');
    api.sendChatMessage.mockResolvedValueOnce({ id: 'held-id', isSent: false });
    await platform.sendChatMessage('held by AutoMod');

    expect(ownMessages.record).toHaveBeenCalledWith(StreamingPlatform.TWITCH, expect.any(Function));
    expect(recorded).toEqual(['sent-id', null]);
  });

  it('refuses to act without a usable grant', async () => {
    const disconnected = setup();
    disconnected.disconnect();

    await expect(disconnected.platform.vods.deleteLatestVod()).rejects.toBeInstanceOf(
      NotAuthenticatedError
    );
    expect(disconnected.api.getVideosByUser).not.toHaveBeenCalled();
  });
});
