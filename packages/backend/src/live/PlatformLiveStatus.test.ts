import 'reflect-metadata';
import { StreamingPlatform } from '@turingmod/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../core/EventBus.js';
import type { IStreamPlatform, LiveBroadcast } from '../platforms/interfaces/IStreamPlatform.js';
import { PlatformRegistry } from '../platforms/PlatformRegistry.js';
import { StreamControlService } from '../platforms/StreamControlService.js';
import { Logger } from '../utils/Logger.js';
import type { ObsStreamState } from './ObsStreamState.js';
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
  let obsStreaming: boolean;
  let changed: ReturnType<typeof vi.fn<() => void>>;
  let service: PlatformLiveStatus;

  beforeEach(() => {
    eventBus = new EventBus(new Logger({ level: 'silent' }));
    twitch = fakePlatform(StreamingPlatform.TWITCH);
    youtube = fakePlatform(StreamingPlatform.YOUTUBE);
    const registry = new PlatformRegistry();
    registry.register(twitch as unknown as IStreamPlatform);
    registry.register(youtube as unknown as IStreamPlatform);
    obsStreaming = true;
    const obsStream = { isStreaming: () => obsStreaming } as unknown as ObsStreamState;
    service = new PlatformLiveStatus(
      eventBus,
      new StreamControlService(registry, eventBus, new Logger({ level: 'silent' })),
      obsStream,
      new Logger({ level: 'silent' })
    );
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

  it("doesn't spend a request on a platform that can't answer", async () => {
    twitch.getUnavailableReason.mockReturnValue('Not connected');

    await service.refresh(StreamingPlatform.TWITCH);

    expect(twitch.getLiveBroadcast).not.toHaveBeenCalled();
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

  describe('a platform still reading live with no stream behind it', () => {
    const Minute = 60_000;
    const broadcast = { startedAt: new Date('2026-01-01T12:00:00Z') };
    const youtubeLive = () => service.getStates()[1]?.live;

    /** YouTube live, with chat streaming and OBS sending the stream out. */
    const goLiveOnYouTube = async () => {
      youtube.getLiveBroadcast.mockResolvedValue(broadcast);
      await eventBus.emit('youtube.chat.state', { state: 'streaming' });
      youtube.getLiveBroadcast.mockClear();
    };
    const obsStops = async () => {
      obsStreaming = false;
      await eventBus.emit('stream.output.changed', { streaming: false });
    };

    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      service.stop();
      vi.useRealTimers();
    });

    it('notices YouTube ending the broadcast a while after OBS stops', async () => {
      await goLiveOnYouTube();

      await obsStops();
      await eventBus.emit('youtube.chat.state', { state: 'idle' });
      expect(youtubeLive()).toBe(true); // YouTube still lists the broadcast as active

      youtube.getLiveBroadcast.mockResolvedValue(null);
      await vi.advanceTimersByTimeAsync(Minute);

      expect(youtubeLive()).toBe(false);
    });

    it('publishes that as a reported end, which is what ends the go-live post', async () => {
      await goLiveOnYouTube();
      const published = vi.fn();
      eventBus.on('platform.liveState', published);

      await obsStops();
      youtube.getLiveBroadcast.mockResolvedValue(null);
      await vi.advanceTimersByTimeAsync(Minute);

      expect(published).toHaveBeenCalledWith(
        expect.objectContaining({
          platform: StreamingPlatform.YOUTUBE,
          live: false,
          cause: 'reported',
        })
      );
    });

    it('notices a Twitch stream.offline that was never delivered, once OBS stops', async () => {
      await eventBus.emit('twitch.stream.online', {
        broadcasterId: '1',
        broadcasterName: 'b',
        broadcasterDisplayName: 'B',
        startedAt: new Date(),
      });

      await obsStops();
      twitch.getLiveBroadcast.mockResolvedValue(null);
      await vi.advanceTimersByTimeAsync(Minute);

      expect(twitchState()?.live).toBe(false);
    });

    it('looks again after chat goes idle, even with OBS still sending', async () => {
      await goLiveOnYouTube();

      await eventBus.emit('youtube.chat.state', { state: 'idle' });
      youtube.getLiveBroadcast.mockResolvedValue(null);
      await vi.advanceTimersByTimeAsync(Minute);

      expect(youtubeLive()).toBe(false);
    });

    it('looks again when a platform reads live with OBS not streaming, as after a restart', async () => {
      obsStreaming = false;
      youtube.getLiveBroadcast.mockResolvedValue(broadcast);
      await service.refresh(StreamingPlatform.YOUTUBE);
      expect(youtubeLive()).toBe(true);

      youtube.getLiveBroadcast.mockResolvedValue(null);
      await vi.advanceTimersByTimeAsync(Minute);

      expect(youtubeLive()).toBe(false);
    });

    it('stops asking as soon as nothing reads live', async () => {
      await goLiveOnYouTube();
      await obsStops();

      youtube.getLiveBroadcast.mockResolvedValue(null);
      await vi.advanceTimersByTimeAsync(Minute);
      expect(youtube.getLiveBroadcast).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(120 * Minute);
      expect(youtube.getLiveBroadcast).toHaveBeenCalledTimes(1);
    });

    it('gives up after about an hour, so an answer that never changes costs little quota', async () => {
      await goLiveOnYouTube();
      await obsStops();

      await vi.advanceTimersByTimeAsync(24 * 60 * Minute);

      expect(youtube.getLiveBroadcast).toHaveBeenCalledTimes(6);
      expect(youtubeLive()).toBe(true);
    });

    it('keeps looking after a failed answer', async () => {
      await goLiveOnYouTube();
      await obsStops();

      youtube.getLiveBroadcast.mockRejectedValueOnce(new Error('network'));
      await vi.advanceTimersByTimeAsync(Minute);
      expect(youtubeLive()).toBe(true);

      youtube.getLiveBroadcast.mockResolvedValue(null);
      await vi.advanceTimersByTimeAsync(2 * Minute);
      expect(youtubeLive()).toBe(false);
    });

    it('stops looking when OBS starts sending again', async () => {
      await goLiveOnYouTube();
      await obsStops();

      obsStreaming = true;
      await eventBus.emit('stream.output.changed', { streaming: true });
      await vi.advanceTimersByTimeAsync(120 * Minute);

      expect(youtube.getLiveBroadcast).not.toHaveBeenCalled();
    });

    it('does not look again while OBS is sending', async () => {
      await goLiveOnYouTube();

      await vi.advanceTimersByTimeAsync(120 * Minute);

      expect(youtube.getLiveBroadcast).not.toHaveBeenCalled();
    });

    it('stops looking when the service stops', async () => {
      await goLiveOnYouTube();
      await obsStops();

      service.stop();
      await vi.advanceTimersByTimeAsync(120 * Minute);

      expect(youtube.getLiveBroadcast).not.toHaveBeenCalled();
    });

    it('does not carry on after stopping while an answer is on its way', async () => {
      await goLiveOnYouTube();
      await obsStops();

      let answer: (broadcast: LiveBroadcast | null) => void = () => {};
      youtube.getLiveBroadcast.mockReturnValueOnce(
        new Promise((resolve) => {
          answer = resolve;
        })
      );
      await vi.advanceTimersByTimeAsync(Minute);
      service.stop();
      answer(broadcast);
      await vi.advanceTimersByTimeAsync(120 * Minute);

      expect(youtube.getLiveBroadcast).toHaveBeenCalledTimes(1);
    });
  });

  describe('Twitch EventSub coming back', () => {
    const eventSubReady = () => eventBus.emit('twitch.eventSub.ready', { sessionId: 's' });

    it('finds a stream.offline sent while the socket was down', async () => {
      await eventBus.emit('twitch.stream.online', {
        broadcasterId: '1',
        broadcasterName: 'b',
        broadcasterDisplayName: 'B',
        startedAt: new Date(),
      });

      twitch.getLiveBroadcast.mockResolvedValue(null);
      await eventSubReady();

      expect(twitchState()?.live).toBe(false);
    });

    it('finds a stream.online sent while the socket was down', async () => {
      twitch.getLiveBroadcast.mockResolvedValue({ startedAt: new Date() });

      await eventSubReady();

      expect(twitchState()?.live).toBe(true);
    });
  });
});
