import 'reflect-metadata';
import { IntegrationStatus, type PlatformLiveState, StreamingPlatform } from '@turingmod/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../core/EventBus.js';
import type { DatabaseManager } from '../database/DatabaseManager.js';
import { GoLivePostRepository } from '../database/repositories/GoLivePostRepository.js';
import { createTestDatabase } from '../database/repositories/testDatabase.js';
import {
  type DiscordIntegration,
  type DiscordMessage,
  DiscordMessageDeletedError,
} from '../integrations/implementations/discord/DiscordIntegration.js';
import type {
  ChannelPage,
  IStreamPlatform,
  StreamInfo,
} from '../platforms/interfaces/IStreamPlatform.js';
import { PlatformRegistry } from '../platforms/PlatformRegistry.js';
import { StreamControlService } from '../platforms/StreamControlService.js';
import { Logger } from '../utils/Logger.js';
import { GO_LIVE_GRACE_MS, GoLiveAnnouncer, PREVIEW_REFRESH_MS } from './GoLiveAnnouncer.js';
import type { PlatformLiveStatus } from './PlatformLiveStatus.js';

const { TWITCH, YOUTUBE } = StreamingPlatform;
const MINUTE = 60_000;

/** Live state comes from the test's `states`, which stand in for PlatformLiveStatus. */
function fakePlatform(
  platform: StreamingPlatform,
  page: ChannelPage,
  info: StreamInfo,
  states: () => Map<StreamingPlatform, PlatformLiveState>
) {
  return {
    platform,
    unavailable: null as string | null,
    getUnavailableReason() {
      return this.unavailable;
    },
    isLive: vi.fn<() => Promise<boolean>>(async () => states().get(platform)?.live ?? false),
    getChannelPage: vi.fn<() => Promise<ChannelPage>>(async () => page),
    getStreamInfo: vi.fn<() => Promise<StreamInfo>>(async () => info),
  };
}

describe('GoLiveAnnouncer', () => {
  let db: DatabaseManager;
  let cleanup: () => Promise<void>;
  let posts: GoLivePostRepository;
  let eventBus: EventBus;
  let controls: StreamControlService;
  let twitch: ReturnType<typeof fakePlatform>;
  let youtube: ReturnType<typeof fakePlatform>;
  let states: Map<StreamingPlatform, PlatformLiveState>;
  let discord: {
    name: string;
    channelId: string | null;
    getNotificationChannelId: () => string | null;
    postMessage: ReturnType<
      typeof vi.fn<(channelId: string, m: DiscordMessage) => Promise<string>>
    >;
    editMessage: ReturnType<
      typeof vi.fn<(channelId: string, messageId: string, m: DiscordMessage) => Promise<void>>
    >;
  };
  let announcer: GoLiveAnnouncer;

  const createAnnouncer = () =>
    new GoLiveAnnouncer(
      eventBus,
      controls,
      { getStates: () => [...states.values()] } as unknown as PlatformLiveStatus,
      discord as unknown as DiscordIntegration,
      posts,
      new Logger({ level: 'silent' })
    );

  const setLive = (platform: StreamingPlatform, live: boolean, startedAt = Date.now()) => {
    const state = { platform, live, startedAt: live ? startedAt : null };
    states.set(platform, state);
    return eventBus.emit('platform.liveState', { ...state, cause: 'reported' });
  };

  /** Let the timers run, then wait for the work they queued. */
  const advance = async (ms: number) => {
    await vi.advanceTimersByTimeAsync(ms);
    await eventBus.emit('stream.info.changed', { platforms: [] });
  };

  const lastEdit = () => discord.editMessage.mock.calls.at(-1)?.[2];

  beforeEach(async () => {
    ({ db, cleanup } = await createTestDatabase());
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
    });
    posts = new GoLivePostRepository(db);
    eventBus = new EventBus(new Logger({ level: 'silent' }));
    twitch = fakePlatform(
      TWITCH,
      {
        displayName: 'Pope_Pontius',
        url: 'https://www.twitch.tv/pope_pontius',
        previewImageUrl: 'https://img.example/twitch.jpg',
      },
      { title: 'Speedruns', game: 'Celeste' },
      () => states
    );
    youtube = fakePlatform(
      YOUTUBE,
      { displayName: 'Pope Pontius', url: 'https://www.youtube.com/watch?v=abc' },
      { title: 'Speedruns' },
      () => states
    );
    const registry = new PlatformRegistry();
    registry.register(twitch as unknown as IStreamPlatform);
    registry.register(youtube as unknown as IStreamPlatform);
    controls = new StreamControlService(registry, eventBus, new Logger({ level: 'silent' }));
    states = new Map([
      [TWITCH, { platform: TWITCH, live: false, startedAt: null }],
      [YOUTUBE, { platform: YOUTUBE, live: false, startedAt: null }],
    ]);
    discord = {
      name: 'discord',
      channelId: '123456789012345678',
      getNotificationChannelId: () => discord.channelId,
      postMessage: vi.fn(async () => '900000000000000001'),
      editMessage: vi.fn(async () => undefined),
    };
    announcer = createAnnouncer();
    await announcer.start();
  });

  afterEach(async () => {
    await announcer.stop();
    vi.useRealTimers();
    await cleanup();
  });

  it('posts once, pinging everyone, when the first platform goes live', async () => {
    await setLive(TWITCH, true);

    expect(discord.postMessage).toHaveBeenCalledTimes(1);
    const [channelId, message] = discord.postMessage.mock.calls[0] ?? [];
    expect(channelId).toBe('123456789012345678');
    expect(message?.pingEveryone).toBe(true);
    expect(message?.content).toContain('Hey @everyone, Pope\\_Pontius is live!');
    expect(message?.content).toContain('Twitch: <https://www.twitch.tv/pope_pontius>');
    expect(message?.embeds[0]?.title).toBe('Speedruns');
    expect(posts.get()?.messageId).toBe('900000000000000001');
  });

  it('adds a second platform to the same post instead of posting again', async () => {
    await setLive(TWITCH, true);
    await setLive(YOUTUBE, true);

    expect(discord.postMessage).toHaveBeenCalledTimes(1);
    expect(discord.editMessage).toHaveBeenCalledTimes(1);
    expect(lastEdit()?.content).toContain('YouTube: <https://www.youtube.com/watch?v=abc>');
  });

  it('makes one post when two platforms go live at the same moment', async () => {
    await Promise.all([setLive(TWITCH, true), setLive(YOUTUBE, true)]);

    expect(discord.postMessage).toHaveBeenCalledTimes(1);
  });

  it('carries on in the same post when the stream comes back within the grace period', async () => {
    await setLive(TWITCH, true);
    await setLive(TWITCH, false);
    await advance(GO_LIVE_GRACE_MS - MINUTE);
    await setLive(TWITCH, true);
    await advance(GO_LIVE_GRACE_MS);

    expect(discord.postMessage).toHaveBeenCalledTimes(1);
    expect(posts.get()).not.toBeNull();
    expect(discord.editMessage.mock.calls.every(([, , m]) => !m.content.includes('was live'))).toBe(
      true
    );
  });

  it('marks the post as ended once every platform has been offline for the grace period', async () => {
    await setLive(TWITCH, true);
    await advance(90 * MINUTE);
    await setLive(TWITCH, false);
    await advance(GO_LIVE_GRACE_MS);

    expect(lastEdit()?.content).toContain('Pope\\_Pontius was live for 1h 30m.');
    expect(lastEdit()?.embeds[0]?.footer?.text).toBe('Stream ended');
    expect(posts.get()).toBeNull();
  });

  it('posts again for the next stream', async () => {
    await setLive(TWITCH, true);
    await setLive(TWITCH, false);
    await advance(GO_LIVE_GRACE_MS);
    await setLive(TWITCH, true);

    expect(discord.postMessage).toHaveBeenCalledTimes(2);
  });

  it('keeps the post open while one platform is still live', async () => {
    await setLive(TWITCH, true);
    await setLive(YOUTUBE, true);
    await setLive(YOUTUBE, false);
    await advance(GO_LIVE_GRACE_MS * 2);

    expect(posts.get()).not.toBeNull();
    expect(lastEdit()?.content).not.toContain('YouTube');
  });

  it('edits the post when the title changes', async () => {
    await setLive(TWITCH, true);
    twitch.getStreamInfo.mockResolvedValue({ title: 'Any% attempts', game: 'Celeste' });

    await eventBus.emit('stream.info.changed', { platforms: [TWITCH] });

    expect(lastEdit()?.embeds[0]?.title).toBe('Any% attempts');
  });

  describe('across a restart', () => {
    const restart = async () => {
      await announcer.stop();
      for (const platform of states.keys()) {
        states.set(platform, { platform, live: false, startedAt: null });
      }
      announcer = createAnnouncer();
      await announcer.start();
    };

    it('picks the post up again when a platform reports live within the grace period', async () => {
      await setLive(TWITCH, true);
      await restart();
      await advance(2 * MINUTE);
      await setLive(TWITCH, true);

      expect(discord.postMessage).toHaveBeenCalledTimes(1);
      expect(posts.get()).not.toBeNull();
    });

    it('ends the post when nothing comes back live', async () => {
      await setLive(TWITCH, true);
      await restart();
      await advance(GO_LIVE_GRACE_MS);

      expect(lastEdit()?.content).toContain('was live');
      expect(posts.get()).toBeNull();
    });

    it('waits for a platform that has not reconnected yet, however long ago the stream was seen', async () => {
      const startedAt = Date.now();
      await setLive(TWITCH, true);
      await announcer.stop();
      vi.setSystemTime(Date.now() + 20 * MINUTE);
      twitch.unavailable = 'Twitch is not connected';
      states.set(TWITCH, { platform: TWITCH, live: false, startedAt: null });
      announcer = createAnnouncer();
      await announcer.start();
      await advance(GO_LIVE_GRACE_MS);
      expect(posts.get()).not.toBeNull();

      // Twitch connects and reports the same broadcast, still going.
      twitch.unavailable = null;
      await setLive(TWITCH, true, startedAt);

      expect(discord.postMessage).toHaveBeenCalledTimes(1);
      expect(posts.get()).not.toBeNull();
      expect(
        discord.editMessage.mock.calls.every(([, , m]) => !m.content.includes('was live'))
      ).toBe(true);
    });

    it('ends a post left from an earlier stream, and announces the new one', async () => {
      await setLive(TWITCH, true);
      await announcer.stop();
      vi.setSystemTime(Date.now() + 24 * 60 * MINUTE);
      states.set(TWITCH, { platform: TWITCH, live: false, startedAt: null });
      twitch.unavailable = 'Twitch is not connected';
      announcer = createAnnouncer();
      await announcer.start();

      twitch.unavailable = null;
      await setLive(TWITCH, true);

      expect(discord.editMessage.mock.calls[0]?.[2].content).toContain('was live');
      expect(discord.postMessage).toHaveBeenCalledTimes(2);
      expect(discord.postMessage.mock.calls[1]?.[1].pingEveryone).toBe(true);
    });

    it('ends the post at once when the stream was last seen longer ago than the grace period', async () => {
      await setLive(TWITCH, true);
      await announcer.stop();
      vi.setSystemTime(Date.now() + 3 * 60 * MINUTE);
      states.set(TWITCH, { platform: TWITCH, live: false, startedAt: null });
      announcer = createAnnouncer();
      await announcer.start();
      await advance(0);

      expect(posts.get()).toBeNull();
      expect(lastEdit()?.content).toContain('was live for 0m.');
    });

    it('measures a crashed stream up to the last heartbeat', async () => {
      await setLive(TWITCH, true);
      await advance(30 * MINUTE);
      // A crash: no stop(), so nothing is recorded beyond the heartbeat. The old instance gets a
      // bus of its own, so it plays no further part.
      eventBus = new EventBus(new Logger({ level: 'silent' }));
      announcer = createAnnouncer();
      states.set(TWITCH, { platform: TWITCH, live: false, startedAt: null });
      await announcer.start();
      await advance(GO_LIVE_GRACE_MS);

      expect(lastEdit()?.content).toContain('was live for 30m.');
    });
  });

  it('keeps the post open while a platform it covered is disconnected', async () => {
    const startedAt = Date.now();
    await setLive(TWITCH, true);
    // Twitch's login lapses: PlatformLiveStatus reports it offline, but nobody knows.
    twitch.unavailable = 'Twitch authorization needs renewing';
    await setLive(TWITCH, false);
    await advance(3 * GO_LIVE_GRACE_MS);
    expect(posts.get()).not.toBeNull();

    twitch.unavailable = null;
    await setLive(TWITCH, true, startedAt);

    expect(discord.postMessage).toHaveBeenCalledTimes(1);
    expect(posts.get()).not.toBeNull();
  });

  it('fetches the preview image again a few minutes after posting', async () => {
    await setLive(TWITCH, true);
    const firstImage = discord.postMessage.mock.calls[0]?.[1].embeds[0]?.image?.url;

    await advance(PREVIEW_REFRESH_MS);

    const refreshed = lastEdit()?.embeds[0]?.image?.url;
    expect(refreshed).toMatch(/^https:\/\/img\.example\/twitch\.jpg\?t=\d+$/);
    expect(refreshed).not.toBe(firstImage);
  });

  it('leaves a deleted post deleted for the rest of the stream', async () => {
    await setLive(TWITCH, true);
    discord.editMessage.mockRejectedValueOnce(new DiscordMessageDeletedError('/messages/1'));
    await setLive(YOUTUBE, true);
    await setLive(YOUTUBE, false);
    await setLive(TWITCH, false);
    await advance(GO_LIVE_GRACE_MS);

    expect(discord.editMessage).toHaveBeenCalledTimes(1);
    expect(discord.postMessage).toHaveBeenCalledTimes(1);
    expect(posts.get()).toBeNull();
  });

  it('does nothing once stopped, even when a timer was due', async () => {
    await setLive(TWITCH, true);
    await setLive(TWITCH, false);
    await announcer.stop();
    await vi.advanceTimersByTimeAsync(GO_LIVE_GRACE_MS);

    expect(discord.editMessage).not.toHaveBeenCalled();
    expect(posts.get()).not.toBeNull();
  });

  describe('while Discord is not running', () => {
    beforeEach(() => {
      discord.channelId = null;
    });

    it('posts once Discord connects', async () => {
      await setLive(TWITCH, true);
      expect(discord.postMessage).not.toHaveBeenCalled();

      discord.channelId = '123456789012345678';
      await eventBus.emit('integration.status', {
        name: 'discord',
        status: IntegrationStatus.CONNECTED,
      });

      expect(discord.postMessage).toHaveBeenCalledTimes(1);
    });
  });

  it('retries a post that failed, on the next heartbeat', async () => {
    discord.postMessage.mockRejectedValueOnce(new Error('Discord answered 503'));

    await setLive(TWITCH, true);
    expect(posts.get()).toBeNull();
    await advance(MINUTE);

    expect(discord.postMessage).toHaveBeenCalledTimes(2);
    expect(posts.get()).not.toBeNull();
  });
});
