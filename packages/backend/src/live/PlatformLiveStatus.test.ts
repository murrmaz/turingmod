import 'reflect-metadata';
import { StreamingPlatform } from '@turingmod/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../core/EventBus.js';
import type { IStreamPlatform, LiveBroadcast } from '../platforms/interfaces/IStreamPlatform.js';
import { PlatformRegistry } from '../platforms/PlatformRegistry.js';
import { Logger } from '../utils/Logger.js';
import { PlatformLiveStatus } from './PlatformLiveStatus.js';

function fakePlatform(platform: StreamingPlatform) {
  return {
    platform,
    getUnavailableReason: vi.fn<() => string | null>(() => null),
    getLiveBroadcast: vi.fn<() => Promise<LiveBroadcast | null>>(async () => null),
  };
}

describe('PlatformLiveStatus', () => {
  let eventBus: EventBus;
  let twitch: ReturnType<typeof fakePlatform>;
  let youtube: ReturnType<typeof fakePlatform>;
  let changed: ReturnType<typeof vi.fn<() => void>>;
  let service: PlatformLiveStatus;

  beforeEach(() => {
    eventBus = new EventBus(new Logger({ level: 'silent' }));
    twitch = fakePlatform(StreamingPlatform.TWITCH);
    youtube = fakePlatform(StreamingPlatform.YOUTUBE);
    const registry = new PlatformRegistry();
    registry.register(twitch as unknown as IStreamPlatform);
    registry.register(youtube as unknown as IStreamPlatform);
    service = new PlatformLiveStatus(eventBus, registry, new Logger({ level: 'silent' }));
    changed = vi.fn<() => void>();
    service.onChange(changed);
    service.start();
  });

  const twitchState = () =>
    service.getStates().find((state) => state.platform === StreamingPlatform.TWITCH);

  it('starts with every platform offline', () => {
    expect(service.getStates()).toEqual([
      { platform: StreamingPlatform.TWITCH, live: false, startedAt: null },
      { platform: StreamingPlatform.YOUTUBE, live: false, startedAt: null },
    ]);
  });

  it('asks a platform when it becomes available, and announces the answer', async () => {
    twitch.getLiveBroadcast.mockResolvedValue({ startedAt: new Date(Date.now() - 60_000) });

    await eventBus.emit('platform.availability', {
      platform: StreamingPlatform.TWITCH,
      available: true,
      reason: null,
    });

    expect(twitchState()?.live).toBe(true);
    expect(twitchState()?.startedAt).toBeGreaterThan(Date.now() - 61_000);
    expect(changed).toHaveBeenCalled();
  });

  it('counts a live broadcast without a start time as live', async () => {
    youtube.getLiveBroadcast.mockResolvedValue({ startedAt: null });

    await eventBus.emit('youtube.chat.state', { state: 'streaming' });

    expect(service.getStates()[1]).toEqual({
      platform: StreamingPlatform.YOUTUBE,
      live: true,
      startedAt: null,
    });
  });

  it('follows Twitch going online and offline without asking it', async () => {
    const startedAt = new Date(Date.now() - 5000);
    await eventBus.emit('twitch.stream.online', {
      broadcasterId: '1',
      broadcasterName: 'b',
      broadcasterDisplayName: 'B',
      startedAt,
    });
    expect(twitchState()).toEqual({
      platform: StreamingPlatform.TWITCH,
      live: true,
      startedAt: startedAt.getTime(),
    });

    await eventBus.emit('twitch.stream.offline', {
      broadcasterId: '1',
      broadcasterName: 'b',
      broadcasterDisplayName: 'B',
    });
    expect(twitchState()?.live).toBe(false);
    expect(twitch.getLiveBroadcast).not.toHaveBeenCalled();
  });

  it('goes offline when a platform becomes unavailable', async () => {
    await eventBus.emit('twitch.stream.online', {
      broadcasterId: '1',
      broadcasterName: 'b',
      broadcasterDisplayName: 'B',
      startedAt: new Date(),
    });

    await eventBus.emit('platform.availability', {
      platform: StreamingPlatform.TWITCH,
      available: false,
      reason: 'needs reauth',
    });

    expect(twitchState()?.live).toBe(false);
  });

  it('drops an answer that a newer one overtook', async () => {
    let resolveSlow: (broadcast: LiveBroadcast | null) => void = () => {};
    twitch.getLiveBroadcast.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSlow = resolve;
      })
    );
    const slow = service.refresh(StreamingPlatform.TWITCH);

    await eventBus.emit('twitch.stream.offline', {
      broadcasterId: '1',
      broadcasterName: 'b',
      broadcasterDisplayName: 'B',
    });
    resolveSlow({ startedAt: new Date() });
    await slow;

    expect(twitchState()?.live).toBe(false);
  });

  it('stays offline when a refresh started before the platform became unavailable', async () => {
    let resolveSlow: (broadcast: LiveBroadcast | null) => void = () => {};
    twitch.getLiveBroadcast.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSlow = resolve;
      })
    );
    const slow = service.refresh(StreamingPlatform.TWITCH);

    await eventBus.emit('platform.availability', {
      platform: StreamingPlatform.TWITCH,
      available: false,
      reason: 'needs reauth',
    });
    resolveSlow({ startedAt: new Date() });
    await slow;

    expect(twitchState()?.live).toBe(false);
  });

  it('publishes going live and going offline, but not a changed start time', async () => {
    const published = vi.fn();
    eventBus.on('platform.liveState', published);
    const online = (startedAt: Date) =>
      eventBus.emit('twitch.stream.online', {
        broadcasterId: '1',
        broadcasterName: 'b',
        broadcasterDisplayName: 'B',
        startedAt,
      });

    await online(new Date(Date.now() - 60_000));
    await online(new Date());
    await eventBus.emit('twitch.stream.offline', {
      broadcasterId: '1',
      broadcasterName: 'b',
      broadcasterDisplayName: 'B',
    });

    expect(published.mock.calls.map(([state]) => state.live)).toEqual([true, false]);
    expect(published.mock.calls.map(([state]) => state.cause)).toEqual(['reported', 'reported']);
  });

  it('publishes a platform it can no longer ask as unavailable, not as reported offline', async () => {
    const published = vi.fn();
    eventBus.on('platform.liveState', published);
    await eventBus.emit('twitch.stream.online', {
      broadcasterId: '1',
      broadcasterName: 'b',
      broadcasterDisplayName: 'B',
      startedAt: new Date(),
    });
    await eventBus.emit('platform.availability', {
      platform: StreamingPlatform.TWITCH,
      available: false,
      reason: 'needs reauth',
    });

    expect(published).toHaveBeenLastCalledWith(
      expect.objectContaining({ live: false, cause: 'unavailable' })
    );
  });

  it('announces only changes', async () => {
    await service.refresh(StreamingPlatform.TWITCH);
    await service.refresh(StreamingPlatform.TWITCH);

    expect(changed).not.toHaveBeenCalled();
  });

  it('keeps its last answer when asking fails', async () => {
    twitch.getLiveBroadcast.mockRejectedValue(new Error('network'));

    await expect(service.refresh(StreamingPlatform.TWITCH)).resolves.toBeUndefined();
    expect(twitchState()?.live).toBe(false);
  });
});
