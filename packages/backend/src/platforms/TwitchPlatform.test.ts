import 'reflect-metadata';
import { IntegrationStatus, StreamingPlatform } from '@turingmod/shared';
import { HttpStatusCodeError } from '@twurple/api-call';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TwitchApiIntegration } from '../integrations/implementations/twitch/TwitchApiIntegration.js';
import type { TwitchAuthIntegration } from '../integrations/implementations/twitch/TwitchAuthIntegration.js';
import { InvalidStreamInfoError, NotAuthenticatedError } from './errors.js';
import type { OwnChatMessages } from './OwnChatMessages.js';
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
      getChannelInfoById: vi.fn(),
      updateChannelInfo: vi.fn(() => Promise.resolve()),
    },
    games: { getGameByName: vi.fn() },
    users: { getUserById: vi.fn(), getUserByName: vi.fn() },
    streams: { getStreamByUserId: vi.fn(), createStreamMarker: vi.fn() },
    videos: { getVideosByUser: vi.fn(), deleteVideosByIds: vi.fn(() => Promise.resolve()) },
    chat: {
      sendAnnouncement: vi.fn(() => Promise.resolve()),
      sendChatMessage: vi.fn(() =>
        Promise.resolve<{
          id: string;
          isSent: boolean;
          dropReasonCode?: string;
          dropReasonMessage?: string;
        }>({ id: 'sent-id', isSent: true })
      ),
      shoutoutUser: vi.fn(() => Promise.resolve()),
    },
    callApi: vi.fn(() => Promise.resolve()),
    schedule: { getSchedule: vi.fn() },
    channelPoints: {
      getCustomRewards: vi.fn(),
      updateCustomReward: vi.fn(() => Promise.resolve()),
      updateRedemptionStatusByIds: vi.fn(() => Promise.resolve()),
    },
    moderation: {
      banUser: vi.fn(() => Promise.resolve()),
      deleteChatMessages: vi.fn(() => Promise.resolve()),
    },
    clips: { getClipById: vi.fn() },
  };
  let stopped: string | null = null;
  const api = {
    request: vi.fn((call: (client: typeof twitch) => Promise<unknown>) =>
      stopped ? Promise.reject(new Error(stopped)) : call(twitch)
    ),
    getStoppedReason: () => stopped,
  };
  const ownMessages = {
    record: vi.fn((_platform: unknown, send: () => Promise<string | null>) =>
      send().then(() => undefined)
    ),
    recordText: vi.fn((_platform: unknown, _text: string, send: () => Promise<void>) => send()),
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
    stopApi: () => {
      stopped = 'Twitch API is stopped';
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

  it("finds a user's id by login name", async () => {
    twitch.users.getUserByName.mockResolvedValueOnce({ id: '12345' });
    twitch.users.getUserByName.mockResolvedValueOnce(null);

    expect(await platform.userLookup.findUserId('the_murms')).toBe('12345');
    expect(twitch.users.getUserByName).toHaveBeenCalledWith('the_murms');
    expect(await platform.userLookup.findUserId('nobody')).toBeNull();
  });

  it('finds nobody for a name that cannot be a login, without asking Twitch', async () => {
    expect(await platform.userLookup.findUserId('not/a/login')).toBeNull();
    expect(twitch.users.getUserByName).not.toHaveBeenCalled();
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

  it('has its own echo recognized by its text, since Twitch returns no id', async () => {
    const { platform, ownMessages } = setup();
    await platform.announcements.sendAnnouncement('Follow me');

    expect(ownMessages.recordText).toHaveBeenCalledWith(
      StreamingPlatform.TWITCH,
      'Follow me',
      expect.any(Function)
    );
  });

  it('never posts a chat message or announcement that starts with a command', async () => {
    await platform.sendChatMessage('!delvod');
    await platform.announcements.sendAnnouncement('/ban someone');

    expect(twitch.chat.sendChatMessage).toHaveBeenCalledWith(BROADCASTER, 'delvod');
    expect(twitch.chat.sendAnnouncement).toHaveBeenCalledWith(BROADCASTER, {
      message: 'ban someone',
    });
  });

  describe('what Twitch does with a message', () => {
    function recording() {
      const context = setup();
      const recorded: (string | null)[] = [];
      context.ownMessages.record.mockImplementation(async (_platform, send) => {
        recorded.push(await send());
      });
      return { ...context, recorded };
    }

    it("records the sent message's id", async () => {
      const { platform, ownMessages, recorded } = recording();

      await platform.sendChatMessage('hello');

      expect(ownMessages.record).toHaveBeenCalledWith(
        StreamingPlatform.TWITCH,
        expect.any(Function)
      );
      expect(recorded).toEqual(['sent-id']);
    });

    it("fails with Twitch's reason when it accepts the request but drops the message", async () => {
      const { platform, twitch, recorded } = recording();
      twitch.chat.sendChatMessage.mockResolvedValueOnce({
        id: 'held-id',
        isSent: false,
        dropReasonCode: 'msg_rejected',
        dropReasonMessage: 'Held by AutoMod',
      });

      await expect(platform.sendChatMessage('hello')).rejects.toThrow(
        "Twitch didn't post the message: Held by AutoMod"
      );
      expect(recorded).toEqual([]);
    });

    it('still fails when Twitch gives no reason', async () => {
      const { platform, twitch } = recording();
      twitch.chat.sendChatMessage.mockResolvedValueOnce({ id: 'held-id', isSent: false });

      await expect(platform.sendChatMessage('hello')).rejects.toThrow(/it gave no reason/);
    });

    it('cuts a message and an announcement to the 500 characters Twitch allows', async () => {
      const { platform, twitch } = setup();

      await platform.sendChatMessage('x'.repeat(600));
      await platform.announcements.sendAnnouncement('y'.repeat(600));

      expect(twitch.chat.sendChatMessage).toHaveBeenCalledWith(BROADCASTER, `${'x'.repeat(499)}…`);
      expect(twitch.chat.sendAnnouncement).toHaveBeenCalledWith(BROADCASTER, {
        message: `${'y'.repeat(499)}…`,
      });
    });
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

  describe('with its API integration stopped', () => {
    it('is unavailable, saying so, though auth is connected', () => {
      const { platform, stopApi } = setup();
      expect(platform.getUnavailableReason()).toBeNull();

      stopApi();

      expect(platform.getUnavailableReason()).toBe('Twitch API is stopped');
    });

    it('reads as not live without asking Twitch', async () => {
      const { platform, stopApi, twitch } = setup();
      stopApi();

      expect(await platform.isLive()).toBe(false);
      expect(twitch.streams.getStreamByUserId).not.toHaveBeenCalled();
    });

    it('fails a call with the reason rather than as a lost authorization', async () => {
      const { platform, stopApi } = setup();
      stopApi();

      const failure = platform.sendChatMessage('hello');

      await expect(failure).rejects.toThrow('Twitch API is stopped');
      await expect(failure).rejects.not.toBeInstanceOf(NotAuthenticatedError);
    });
  });

  describe('reading the channel', () => {
    it('reads the title, game and tags, leaving out what is not set', async () => {
      const { platform, twitch } = setup();
      twitch.channels.getChannelInfoById
        .mockResolvedValueOnce({ title: 'T', gameName: 'Celeste', tags: ['a'] })
        .mockResolvedValueOnce({ title: 'T', gameName: '', tags: [] });

      expect(await platform.getStreamInfo()).toEqual({ title: 'T', game: 'Celeste', tags: ['a'] });
      expect(await platform.getStreamInfo()).toEqual({ title: 'T' });
    });

    it('fails when Twitch has no such channel', async () => {
      const { platform, twitch } = setup();
      twitch.channels.getChannelInfoById.mockResolvedValue(null);

      await expect(platform.getStreamInfo()).rejects.toThrow('Failed to retrieve channel');
      await expect(platform.contentLabels.getContentLabels()).rejects.toThrow(
        'Failed to retrieve channel'
      );
    });

    it('reads the live broadcast, and null when offline', async () => {
      const { platform, twitch } = setup();
      const startDate = new Date(1_000);
      twitch.streams.getStreamByUserId
        .mockResolvedValueOnce({ startDate })
        .mockResolvedValueOnce(null);

      expect(await platform.getLiveBroadcast()).toEqual({ startedAt: startDate });
      expect(await platform.getLiveBroadcast()).toBeNull();
    });

    it("doesn't ask whether it's live while disconnected", async () => {
      const { platform, twitch, disconnect } = setup();
      disconnect();

      expect(await platform.isLive()).toBe(false);
      expect(twitch.streams.getStreamByUserId).not.toHaveBeenCalled();
    });

    it('builds the channel page from the broadcaster', async () => {
      const { platform, twitch } = setup();
      twitch.users.getUserById.mockResolvedValue({ displayName: 'Streamer', name: 'streamer' });

      const page = await platform.getChannelPage();

      expect(page).toMatchObject({
        displayName: 'Streamer',
        url: 'https://www.twitch.tv/streamer',
      });
      expect(page.previewImageUrl).toContain('live_user_streamer');
    });

    it('has no bio for one that is only whitespace', async () => {
      const { platform, twitch } = setup();
      twitch.users.getUserById
        .mockResolvedValueOnce({ description: '  Hello  ' })
        .mockResolvedValueOnce({ description: '   ' });

      expect(await platform.broadcasterAbout.getBroadcasterAbout()).toBe('Hello');
      expect(await platform.broadcasterAbout.getBroadcasterAbout()).toBeNull();
    });
  });

  describe('getNextAdBreak', () => {
    it('is null while offline, without asking for the schedule', async () => {
      const { platform, twitch } = setup();
      twitch.streams.getStreamByUserId.mockResolvedValue(null);

      expect(await platform.ads.getNextAdBreak()).toBeNull();
      expect(twitch.channels.getAdSchedule).not.toHaveBeenCalled();
    });

    it('reports the next ad while live', async () => {
      const { platform, twitch } = setup();
      const nextAdDate = new Date(5_000);
      twitch.streams.getStreamByUserId.mockResolvedValue({});
      twitch.channels.getAdSchedule.mockResolvedValue({ nextAdDate });

      expect(await platform.ads.getNextAdBreak()).toEqual({ nextAdDate });
    });
  });

  it('maps schedule segments, leaving out what is not set', async () => {
    const { platform, twitch } = setup();
    const startDate = new Date(1_000);
    twitch.schedule.getSchedule.mockResolvedValue({
      data: {
        segments: [
          { startDate, title: 'Runs', categoryName: 'Celeste' },
          { startDate, title: '' },
        ],
      },
    });

    expect(await platform.schedule.getSchedule()).toEqual([
      { startDate, title: 'Runs', category: 'Celeste' },
      { startDate },
    ]);
  });

  it('reads no schedule as empty, since Twitch answers 404 for one never created', async () => {
    const { platform, twitch } = setup();
    twitch.schedule.getSchedule.mockRejectedValue(
      new HttpStatusCodeError(404, 'Not Found', 'https://x', 'GET', '', true)
    );

    expect(await platform.schedule.getSchedule()).toEqual([]);
  });

  it('fails on any other error reading the schedule', async () => {
    const { platform, twitch } = setup();
    twitch.schedule.getSchedule.mockRejectedValue(
      new HttpStatusCodeError(500, 'Server Error', 'https://x', 'GET', '', true)
    );

    await expect(platform.schedule.getSchedule()).rejects.toThrow('500');
  });

  it('fails a shoutout for someone who does not exist', async () => {
    const { platform, twitch } = setup();
    twitch.users.getUserByName.mockResolvedValue(null);

    const failed = platform.shoutout.shoutout('nobody');

    await expect(failed).rejects.toThrow(InvalidStreamInfoError);
    await expect(failed).rejects.toThrow('Twitch channel not found: nobody');
    expect(twitch.chat.shoutoutUser).not.toHaveBeenCalled();
  });

  it('fails a shoutout for a name that cannot be a login, without asking Twitch', async () => {
    const { platform, twitch } = setup();

    await expect(platform.shoutout.shoutout('not/a/login')).rejects.toThrow(InvalidStreamInfoError);
    expect(twitch.users.getUserByName).not.toHaveBeenCalled();
  });

  describe('channel points', () => {
    const reward = (id: string) => ({
      id,
      title: id,
      cost: 100,
      prompt: '',
      userInputRequired: false,
      globalCooldown: null,
      maxRedemptionsPerStream: null,
      maxRedemptionsPerUserPerStream: null,
      autoFulfill: false,
      isEnabled: true,
      isPaused: false,
    });

    it('tells apart the rewards this application may edit', async () => {
      const { platform, twitch } = setup();
      twitch.channelPoints.getCustomRewards.mockImplementation((_id: string, onlyOurs: boolean) =>
        Promise.resolve(onlyOurs ? [reward('ours')] : [reward('ours'), reward('theirs')])
      );

      const rewards = await platform.channelPoints.getChannelRewards();

      expect(rewards.map(({ id, manageable }) => [id, manageable])).toEqual([
        ['ours', true],
        ['theirs', false],
      ]);
    });

    it('sends only the fields being changed', async () => {
      const { platform, twitch } = setup();

      await platform.channelPoints.updateChannelReward('r1', {
        cost: 200,
        isPaused: true,
        globalCooldownSeconds: null,
      });

      expect(twitch.channelPoints.updateCustomReward).toHaveBeenCalledWith(BROADCASTER, 'r1', {
        cost: 200,
        isPaused: true,
        globalCooldown: null,
      });
    });

    it.each([
      ['fulfilled', 'FULFILLED'],
      ['canceled', 'CANCELED'],
    ] as const)('marks a redemption %s', async (outcome, status) => {
      const { platform, twitch } = setup();

      await platform.channelPoints.resolveRedemption('r1', 'd1', outcome);

      expect(twitch.channelPoints.updateRedemptionStatusByIds).toHaveBeenCalledWith(
        BROADCASTER,
        'r1',
        ['d1'],
        status
      );
    });
  });

  describe('moderation', () => {
    it('times someone out as the broadcaster', async () => {
      const { platform, twitch } = setup();

      await platform.moderation.timeoutUser('u1', 60, 'spam');

      expect(twitch.moderation.banUser).toHaveBeenCalledWith(BROADCASTER, {
        user: 'u1',
        duration: 60,
        reason: 'spam',
      });
    });

    it('deletes a message as the broadcaster', async () => {
      const { platform, twitch } = setup();

      await platform.moderation.deleteChatMessage('m1');

      expect(twitch.moderation.deleteChatMessages).toHaveBeenCalledWith(BROADCASTER, 'm1');
    });
  });

  it('reads a clip, and null for one that does not exist', async () => {
    const { platform, twitch } = setup();
    const creationDate = new Date(1_000);
    twitch.clips.getClipById
      .mockResolvedValueOnce({
        id: 'c1',
        url: 'https://clips.twitch.tv/c1',
        title: 'Nice',
        creatorDisplayName: 'Someone',
        broadcasterDisplayName: 'Streamer',
        views: 3,
        creationDate,
      })
      .mockResolvedValueOnce(null);

    expect(await platform.clips.getClip('c1')).toEqual({
      id: 'c1',
      url: 'https://clips.twitch.tv/c1',
      title: 'Nice',
      creatorName: 'Someone',
      broadcasterName: 'Streamer',
      views: 3,
      createdAt: creationDate,
    });
    expect(await platform.clips.getClip('gone')).toBeNull();
  });
});
