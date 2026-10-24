import 'reflect-metadata';
import { MessageType, StreamingPlatform } from '@turingmod/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../core/EventBus.js';
import type { IStreamPlatform } from '../platforms/interfaces/IStreamPlatform.js';
import { PlatformRegistry } from '../platforms/PlatformRegistry.js';
import type { WebSocketServer } from '../server/WebSocketServer.js';
import { Logger } from '../utils/Logger.js';
import { PlatformLiveStatus } from './PlatformLiveStatus.js';

function fakePlatform(platform: StreamingPlatform) {
  return {
    platform,
    getUnavailableReason: vi.fn<() => string | null>(() => null),
    getUptime: vi.fn<() => Promise<number | null>>(async () => null),
    isLive: vi.fn<() => Promise<boolean>>(async () => false),
  };
}

describe('PlatformLiveStatus', () => {
  let eventBus: EventBus;
  let twitch: ReturnType<typeof fakePlatform>;
  let youtube: ReturnType<typeof fakePlatform>;
  let broadcast: ReturnType<typeof vi.fn>;
  let service: PlatformLiveStatus;

  beforeEach(() => {
    eventBus = new EventBus(new Logger({ level: 'silent' }));
    twitch = fakePlatform(StreamingPlatform.TWITCH);
    youtube = fakePlatform(StreamingPlatform.YOUTUBE);
    const registry = new PlatformRegistry();
    registry.register(twitch as unknown as IStreamPlatform);
    registry.register(youtube as unknown as IStreamPlatform);
    broadcast = vi.fn();
    service = new PlatformLiveStatus(
      eventBus,
      registry,
      { broadcast } as unknown as WebSocketServer,
      new Logger({ level: 'silent' })
    );
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

  it('asks a platform when it becomes available, and pushes the answer', async () => {
    twitch.getUptime.mockResolvedValue(60_000);

    await eventBus.emit('platform.availability', {
      platform: StreamingPlatform.TWITCH,
      available: true,
      reason: null,
    });

    expect(twitchState()?.live).toBe(true);
    expect(twitchState()?.startedAt).toBeGreaterThan(Date.now() - 61_000);
    expect(broadcast).toHaveBeenCalledWith(
      expect.objectContaining({ type: MessageType.PLATFORM_LIVE_STATE })
    );
  });

  it('counts a live broadcast without a start time as live', async () => {
    youtube.isLive.mockResolvedValue(true);

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
    expect(twitch.getUptime).not.toHaveBeenCalled();
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
    let resolveSlow: (uptime: number | null) => void = () => {};
    twitch.getUptime.mockReturnValueOnce(
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
    resolveSlow(1000);
    await slow;

    expect(twitchState()?.live).toBe(false);
  });

  it('stays offline when a refresh started before the platform became unavailable', async () => {
    let resolveSlow: (uptime: number | null) => void = () => {};
    twitch.getUptime.mockReturnValueOnce(
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
    resolveSlow(1000);
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

  it('pushes only changes', async () => {
    await service.refresh(StreamingPlatform.TWITCH);
    await service.refresh(StreamingPlatform.TWITCH);

    expect(broadcast).not.toHaveBeenCalled();
  });

  it('keeps its last answer when asking fails', async () => {
    twitch.getUptime.mockRejectedValue(new Error('network'));

    await expect(service.refresh(StreamingPlatform.TWITCH)).resolves.toBeUndefined();
    expect(twitchState()?.live).toBe(false);
  });
});
