import 'reflect-metadata';
import { IntegrationStatus, StreamingPlatform } from '@turingmod/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OwnChatMessages } from '../chat/OwnChatMessages.js';
import type { TwitchApiIntegration } from '../integrations/implementations/twitch/TwitchApiIntegration.js';
import type { TwitchAuthIntegration } from '../integrations/implementations/twitch/TwitchAuthIntegration.js';
import { InvalidStreamInfoError, NotAuthenticatedError } from './errors.js';
import { TwitchPlatform } from './TwitchPlatform.js';

const BROADCASTER = 'broadcaster-id';

function setup() {
  let status = IntegrationStatus.CONNECTED;
  const auth = {
    getStatus: () => status,
    getErrorMessage: () => undefined,
    getAuthenticatedUserId: () => BROADCASTER,
  };
  // The slice of Twurple's ApiClient these tests touch. request() runs each call against it,
  // the way TwitchApiIntegration does with its live client.
  const twitch = {
    channels: {
      getAdSchedule: vi.fn(),
      snoozeNextAd: vi.fn(),
      getChannelFollowers: vi.fn(),
      updateChannelInfo: vi.fn(() => Promise.resolve()),
    },
    games: { getGameByName: vi.fn() },
    users: { getUserById: vi.fn(), getUserByName: vi.fn() },
    streams: { getStreamByUserId: vi.fn(), createStreamMarker: vi.fn() },
    videos: { getVideosByUser: vi.fn(), deleteVideosByIds: vi.fn(() => Promise.resolve()) },
    chat: {
      sendAnnouncement: vi.fn(() => Promise.resolve()),
      sendChatMessage: vi.fn(() => Promise.resolve({ id: 'sent-id', isSent: true })),
      shoutoutUser: vi.fn(() => Promise.resolve()),
    },
    callApi: vi.fn(() => Promise.resolve()),
  };
  const api = {
    request: vi.fn((call: (client: typeof twitch) => Promise<unknown>) => call(twitch)),
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
    twitch,
    ownMessages,
    platform,
    disconnect: () => {
      status = IntegrationStatus.DISCONNECTED;
    },
  };
}

describe('TwitchPlatform', () => {
  let twitch: ReturnType<typeof setup>['twitch'];
  let platform: TwitchPlatform;

  beforeEach(() => {
    ({ twitch, platform } = setup());
  });

  describe('snoozeNextAd', () => {
    it('snoozes when a snooze is left', async () => {
      const nextAdDate = new Date(1000);
      twitch.channels.getAdSchedule.mockResolvedValue({ snoozeCount: 2, nextAdDate: new Date(0) });
      twitch.channels.snoozeNextAd.mockResolvedValue({ snoozeCount: 1, nextAdDate });

      expect(await platform.ads.snoozeNextAd()).toEqual({
        snoozed: true,
        snoozesLeft: 1,
        nextAdDate,
      });
    });

    it('reports, rather than attempts, a snooze with none left', async () => {
      const nextAdDate = new Date(0);
      twitch.channels.getAdSchedule.mockResolvedValue({ snoozeCount: 0, nextAdDate });

      expect(await platform.ads.snoozeNextAd()).toEqual({
        snoozed: false,
        snoozesLeft: 0,
        nextAdDate,
      });
      expect(twitch.channels.snoozeNextAd).not.toHaveBeenCalled();
    });
  });

  it('reads a follow date, or null for a non-follower', async () => {
    const followDate = new Date(5000);
    twitch.channels.getChannelFollowers.mockResolvedValueOnce({ data: [{ followDate }] });
    twitch.channels.getChannelFollowers.mockResolvedValueOnce({ data: [] });

    expect(await platform.followInfo.getFollowDate('viewer')).toBe(followDate);
    expect(await platform.followInfo.getFollowDate('stranger')).toBeNull();
    expect(twitch.channels.getChannelFollowers).toHaveBeenCalledWith(BROADCASTER, 'viewer');
  });

  it("reads an account's creation date", async () => {
    const creationDate = new Date(7000);
    twitch.users.getUserById.mockResolvedValue({ creationDate });

    expect(await platform.accountAge.getAccountCreatedAt('viewer')).toBe(creationDate);
  });

  describe('createStreamMarker', () => {
    it('marks the live broadcast', async () => {
      twitch.streams.getStreamByUserId.mockResolvedValue({});
      twitch.streams.createStreamMarker.mockResolvedValue({
        positionInSeconds: 754,
        description: 'clip',
      });

      expect(await platform.markers.createStreamMarker('clip')).toEqual({
        positionSeconds: 754,
        description: 'clip',
      });
      expect(twitch.streams.createStreamMarker).toHaveBeenCalledWith(BROADCASTER, 'clip');
    });

    it('explains that markers need a live broadcast', async () => {
      twitch.streams.getStreamByUserId.mockResolvedValue(null);

      await expect(platform.markers.createStreamMarker()).rejects.toThrow(
        'Stream markers can only be created while live'
      );
      expect(twitch.streams.createStreamMarker).not.toHaveBeenCalled();
    });
  });

  describe('deleteLatestVod', () => {
    it('deletes the most recent past broadcast', async () => {
      const createdAt = new Date(9000);
      twitch.videos.getVideosByUser.mockResolvedValue({
        data: [{ id: 'v1', title: 'Last stream', url: 'https://x/v1', creationDate: createdAt }],
      });

      expect(await platform.vods.deleteLatestVod()).toEqual({
        id: 'v1',
        title: 'Last stream',
        url: 'https://x/v1',
        createdAt,
      });
      expect(twitch.videos.getVideosByUser).toHaveBeenCalledWith(BROADCASTER, {
        type: 'archive',
        limit: 1,
      });
      expect(twitch.videos.deleteVideosByIds).toHaveBeenCalledWith(BROADCASTER, ['v1']);
    });

    it('deletes nothing when there is no past broadcast', async () => {
      twitch.videos.getVideosByUser.mockResolvedValue({ data: [] });

      expect(await platform.vods.deleteLatestVod()).toBeNull();
      expect(twitch.videos.deleteVideosByIds).not.toHaveBeenCalled();
    });
  });

  it('posts an announcement', async () => {
    await platform.announcements.sendAnnouncement('Follow me');

    expect(twitch.chat.sendAnnouncement).toHaveBeenCalledWith(BROADCASTER, {
      message: 'Follow me',
    });
  });

  it('never posts a chat message or announcement that starts with a command', async () => {
    await platform.sendChatMessage('!delvod');
    await platform.announcements.sendAnnouncement('/ban someone');

    expect(twitch.chat.sendChatMessage).toHaveBeenCalledWith(BROADCASTER, 'delvod');
    expect(twitch.chat.sendAnnouncement).toHaveBeenCalledWith(BROADCASTER, {
      message: 'ban someone',
    });
  });

  it("records the sent message's id, or nothing when Twitch dropped it", async () => {
    const { platform, twitch, ownMessages } = setup();
    const recorded: (string | null)[] = [];
    ownMessages.record.mockImplementation(async (_platform, send) => {
      recorded.push(await send());
    });

    await platform.sendChatMessage('hello');
    twitch.chat.sendChatMessage.mockResolvedValueOnce({ id: 'held-id', isSent: false });
    await platform.sendChatMessage('held by AutoMod');

    expect(ownMessages.record).toHaveBeenCalledWith(StreamingPlatform.TWITCH, expect.any(Function));
    expect(recorded).toEqual(['sent-id', null]);
  });

  describe('setStreamInfo', () => {
    it('changes title, game and tags in one update', async () => {
      twitch.games.getGameByName.mockResolvedValue({ id: 'game-1' });

      await platform.setStreamInfo({ title: 'Hello', game: 'Celeste', tags: ['speedrun'] });

      expect(twitch.channels.updateChannelInfo).toHaveBeenCalledTimes(1);
      expect(twitch.channels.updateChannelInfo).toHaveBeenCalledWith(BROADCASTER, {
        title: 'Hello',
        gameId: 'game-1',
        tags: ['speedrun'],
      });
    });

    it('changes nothing when the game is unknown', async () => {
      twitch.games.getGameByName.mockResolvedValue(null);

      await expect(platform.setStreamInfo({ title: 'Hello', game: 'Nope' })).rejects.toThrow(
        'Game not found: Nope'
      );
      expect(twitch.channels.updateChannelInfo).not.toHaveBeenCalled();
    });
  });

  describe('setContentLabels', () => {
    /** Every label sent to Helix, and which of them were on. */
    const sentLabels = () => {
      const [[options]] = twitch.callApi.mock.calls as unknown as [
        [{ jsonBody: { content_classification_labels: { id: string; is_enabled: boolean }[] } }],
      ];
      const labels = options.jsonBody.content_classification_labels;
      return {
        sent: labels.length,
        enabled: labels.filter((label) => label.is_enabled).map((label) => label.id),
      };
    };

    it('sends every label, on for those asked for, whatever their case', async () => {
      await platform.contentLabels.setContentLabels(['gambling', 'ProfanityVulgarity']);

      expect(sentLabels()).toEqual({ sent: 6, enabled: ['Gambling', 'ProfanityVulgarity'] });
    });

    it('turns every label off for an empty list', async () => {
      await platform.contentLabels.setContentLabels([]);

      expect(sentLabels()).toEqual({ sent: 6, enabled: [] });
    });

    it('refuses an unknown label without calling Twitch', async () => {
      await expect(platform.contentLabels.setContentLabels(['Spiders'])).rejects.toThrow(
        InvalidStreamInfoError
      );
      expect(twitch.callApi).not.toHaveBeenCalled();
    });
  });

  it('declines a shoutout inside the cooldown without calling Twitch', async () => {
    twitch.users.getUserByName.mockResolvedValue({ id: 'raider' });

    expect(await platform.shoutout.shoutout('raider')).toEqual({ sent: true });
    expect(await platform.shoutout.shoutout('raider')).toMatchObject({
      sent: false,
      reason: 'global_cooldown',
    });
    expect(twitch.chat.shoutoutUser).toHaveBeenCalledTimes(1);
  });

  it('refuses to act without a usable grant', async () => {
    const disconnected = setup();
    disconnected.disconnect();

    await expect(disconnected.platform.vods.deleteLatestVod()).rejects.toBeInstanceOf(
      NotAuthenticatedError
    );
    expect(disconnected.twitch.videos.getVideosByUser).not.toHaveBeenCalled();
  });
});
