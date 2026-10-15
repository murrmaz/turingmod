import 'reflect-metadata';
import { IntegrationStatus, StreamingPlatform } from '@turingmod/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../core/EventBus.js';
import type { TwitchAdBreakEvent } from '../core/events.js';
import type { ObsBreakRestoreRepository } from '../database/repositories/ObsBreakRestoreRepository.js';
import type {
  SettingsDefinition,
  SettingsRepository,
} from '../database/repositories/SettingsRepository.js';
import type { ObsIntegration } from '../integrations/implementations/obs/ObsIntegration.js';
import type { StreamControlService } from '../platforms/StreamControlService.js';
import type { SoundLibrary } from '../sounds/SoundLibrary.js';
import { Logger } from '../utils/Logger.js';
import { BreakService } from './BreakService.js';
import type { ObsBreakOverlay, ObsBreakSnapshot } from './ObsBreakOverlay.js';

/** What applying the overlay records: the mic was live before the break. */
const micSnapshot = (): ObsBreakSnapshot => ({
  items: new Map(),
  inputs: new Map([['Mic/Aux', false]]),
});

function setup(stored: unknown = null, { owed = null as unknown } = {}) {
  const eventBus = new EventBus(new Logger({ level: 'silent' }));
  const overlay = {
    apply: vi.fn((_settings: unknown, recorded?: ObsBreakSnapshot) =>
      Promise.resolve(recorded ?? micSnapshot())
    ),
    restore: vi.fn((_snapshot: ObsBreakSnapshot) => Promise.resolve(true)),
  };
  /** The stored restore, as `ObsBreakRestoreRepository` would hold it. */
  const restoreRepo = {
    owed,
    get: vi.fn(() => {
      if (restoreRepo.owed instanceof Error) {
        throw restoreRepo.owed;
      }
      return restoreRepo.owed as ObsBreakSnapshot | null;
    }),
    save: vi.fn((snapshot: ObsBreakSnapshot) => {
      restoreRepo.owed = snapshot;
    }),
    clear: vi.fn(() => {
      restoreRepo.owed = null;
    }),
  };
  const obs = { name: 'obs', status: IntegrationStatus.CONNECTED, getStatus: () => obs.status };
  /** Messages posted, per platform, as rendered for Twitch and YouTube. */
  const posted: Record<string, string>[] = [];
  const streamControl = {
    announce: vi.fn((messageFor: (p: StreamingPlatform) => string | null) => {
      const twitch = messageFor(StreamingPlatform.TWITCH);
      const youtube = messageFor(StreamingPlatform.YOUTUBE);
      posted.push({ ...(twitch && { twitch }), ...(youtube && { youtube }) });
      return Promise.resolve({ updated: [], failures: [] });
    }),
  };
  const settingsRepo = {
    get: (definition: SettingsDefinition<unknown>) => definition.schema.parse(stored ?? {}),
  };
  const sounds = { tryPlay: vi.fn(() => Promise.resolve()) };
  const service = new BreakService(
    eventBus,
    settingsRepo as unknown as SettingsRepository,
    overlay as unknown as ObsBreakOverlay,
    restoreRepo as unknown as ObsBreakRestoreRepository,
    obs as unknown as ObsIntegration,
    streamControl as unknown as StreamControlService,
    sounds as unknown as SoundLibrary,
    new Logger({ level: 'silent' })
  );
  /** OBS reconnecting, as IntegrationManager reports it. */
  const obsConnects = () => {
    obs.status = IntegrationStatus.CONNECTED;
    return eventBus.emit('integration.status', { name: 'obs', status: obs.status });
  };
  return {
    eventBus,
    overlay,
    restoreRepo,
    obs,
    obsConnects,
    streamControl,
    posted,
    service,
    sounds,
  };
}

function adBreak(durationSeconds: number): TwitchAdBreakEvent {
  return {
    durationSeconds,
    startedAt: new Date(0),
    isAutomatic: true,
    broadcasterId: 'broadcaster-id',
    broadcasterName: 'streamer',
    broadcasterDisplayName: 'Streamer',
  };
}

describe('BreakService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs a Twitch ad break for the ad duration and then restores OBS', async () => {
    const { eventBus, overlay, posted, service } = setup();
    await service.start();

    await eventBus.emit('twitch.ad.break', adBreak(90));

    expect(overlay.apply).toHaveBeenCalledOnce();
    expect(posted[0]).toEqual({
      twitch: 'Ads are running for 1m 30s. Back soon!',
      youtube: 'Taking a short break, back in about 1m 30s.',
    });
    expect(overlay.restore).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(90_000);

    expect(overlay.restore).toHaveBeenCalledOnce();
    expect(posted[1]).toEqual({
      twitch: "Break's over, welcome back!",
      youtube: "Break's over, welcome back!",
    });
    expect(service.getBreakEndsAt()).toBeNull();
  });

  it('plays the configured break sounds from the sound library', async () => {
    const { eventBus, sounds, service } = setup({
      sounds: { breakStarted: 'ad warn.wav', breakEnded: 'ad done.wav' },
    });
    await service.start();

    await eventBus.emit('twitch.ad.break', adBreak(30));
    expect(sounds.tryPlay).toHaveBeenCalledWith('ad warn.wav');

    await service.endBreak();
    expect(sounds.tryPlay).toHaveBeenCalledWith('ad done.wav');
  });

  it('plays no break sounds by default', async () => {
    const { eventBus, sounds, service } = setup();
    await service.start();

    await eventBus.emit('twitch.ad.break', adBreak(30));
    await service.endBreak();

    expect(sounds.tryPlay).not.toHaveBeenCalled();
  });

  it('extends a running break instead of snapshotting the break state', async () => {
    const { overlay, service } = setup();
    await service.start();

    await service.startBreak('ad', 60);
    await vi.advanceTimersByTimeAsync(30_000);
    const second = await service.startBreak('ad', 90);

    expect(second.extended).toBe(true);
    expect(overlay.apply).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(60_000); // past the original end
    expect(overlay.restore).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(30_000); // past the extended end
    expect(overlay.restore).toHaveBeenCalledOnce();
  });

  it('does not shorten a running break', async () => {
    const { service } = setup();
    await service.start();

    const first = await service.startBreak('manual', 300);
    const second = await service.startBreak('ad', 30);

    expect(second.endsAt).toBe(first.endsAt);
  });

  it('treats a second trigger during the OBS update as an extension', async () => {
    const { overlay, service } = setup();
    let finishApply: (s: ObsBreakSnapshot) => void = () => {};
    overlay.apply.mockImplementationOnce(
      () => new Promise<ObsBreakSnapshot>((resolve) => (finishApply = resolve))
    );
    await service.start();

    const first = service.startBreak('ad', 60);
    const second = await service.startBreak('ad', 60);
    await vi.advanceTimersByTimeAsync(0); // let the queued apply begin
    finishApply(micSnapshot());
    await first;

    expect(second.extended).toBe(true);
    expect(overlay.apply).toHaveBeenCalledOnce();
  });

  it('restores with the snapshot taken at the start', async () => {
    const { overlay, service } = setup();
    const snapshot = micSnapshot();
    overlay.apply.mockResolvedValueOnce(snapshot);
    await service.start();

    await service.startBreak('manual', 60);
    await service.endBreak();

    expect(overlay.restore).toHaveBeenCalledWith(snapshot);
  });

  it('ignores Twitch ad breaks when automatic breaks are disabled', async () => {
    const { eventBus, overlay, service } = setup({ enabled: false });
    await service.start();

    await eventBus.emit('twitch.ad.break', adBreak(90));

    expect(overlay.apply).not.toHaveBeenCalled();
  });

  it('emits started and ended events', async () => {
    const { eventBus, service } = setup();
    const started = vi.fn();
    const ended = vi.fn();
    eventBus.on('stream.break.started', started);
    eventBus.on('stream.break.ended', ended);
    await service.start();

    await service.startBreak('manual', 120);
    await vi.advanceTimersByTimeAsync(120_000);

    expect(started).toHaveBeenCalledWith({ reason: 'manual', durationSeconds: 120 });
    expect(ended).toHaveBeenCalledWith({ reason: 'manual', durationSeconds: 120 });
  });

  it('restores OBS without announcing when stopped mid-break', async () => {
    const { eventBus, overlay, posted, service } = setup();
    await service.start();
    await service.startBreak('ad', 180);

    await service.stop();

    expect(overlay.restore).toHaveBeenCalledOnce();
    expect(posted).toHaveLength(1); // only the start
    await eventBus.emit('twitch.ad.break', adBreak(90));
    expect(overlay.apply).toHaveBeenCalledOnce(); // no longer listening
  });

  it('refuses to start a break once stopped, so none outlives the OBS connection', async () => {
    const { overlay, service } = setup();
    await service.start();
    await service.stop();

    await expect(service.startBreak('manual', 60)).rejects.toThrow(/shutting down/);
    expect(overlay.apply).not.toHaveBeenCalled();
  });

  it('still runs and restores the break when chat is unreachable', async () => {
    const { overlay, streamControl, service } = setup();
    streamControl.announce.mockRejectedValue(new Error('chat down'));
    await service.start();

    await service.startBreak('ad', 60);
    expect(overlay.apply).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(overlay.restore).toHaveBeenCalledOnce();
  });

  it('rejects a non-positive duration', async () => {
    const { service } = setup();
    await service.start();

    await expect(service.startBreak('manual', 0)).rejects.toThrow(/duration/);
  });

  describe('restoring OBS', () => {
    it('stores what the break changed until it has been put back', async () => {
      const { restoreRepo, service } = setup();
      await service.start();

      await service.startBreak('ad', 60);
      expect(restoreRepo.owed).toEqual(micSnapshot());

      await service.endBreak();
      expect(restoreRepo.owed).toBeNull();
    });

    it('stores nothing for a break that changed nothing in OBS', async () => {
      const { overlay, restoreRepo, service } = setup();
      overlay.apply.mockResolvedValueOnce({ items: new Map(), inputs: new Map() });
      await service.start();

      await service.startBreak('ad', 60);
      await service.endBreak();

      expect(restoreRepo.save).not.toHaveBeenCalled();
      expect(overlay.restore).not.toHaveBeenCalled();
    });

    it('restores once OBS is back when the break ended while it was down', async () => {
      const { obs, obsConnects, overlay, restoreRepo, service } = setup();
      await service.start();
      await service.startBreak('ad', 60);

      obs.status = IntegrationStatus.DISCONNECTED;
      overlay.restore.mockResolvedValueOnce(false);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(service.getBreakEndsAt()).toBeNull();
      expect(restoreRepo.owed).toEqual(micSnapshot());

      await obsConnects();

      expect(overlay.restore).toHaveBeenLastCalledWith(micSnapshot());
      expect(restoreRepo.owed).toBeNull();
    });

    it('restores what an earlier run left once OBS connects', async () => {
      const { obs, obsConnects, overlay, restoreRepo, service } = setup(null, {
        owed: micSnapshot(),
      });
      obs.status = IntegrationStatus.DISCONNECTED;
      await service.start();
      expect(overlay.restore).not.toHaveBeenCalled();

      await obsConnects();

      expect(overlay.restore).toHaveBeenCalledWith(micSnapshot());
      expect(restoreRepo.owed).toBeNull();
    });

    it('restores at start what an earlier run left when OBS is already connected', async () => {
      const { overlay, service } = setup(null, { owed: micSnapshot() });

      await service.start();
      await service.stop();

      expect(overlay.restore).toHaveBeenCalledWith(micSnapshot());
    });

    it('applies the overlay again when OBS reconnects mid-break, keeping the pre-break state', async () => {
      const { obsConnects, overlay, service } = setup();
      await service.start();
      await service.startBreak('ad', 60);

      await obsConnects();

      expect(overlay.apply).toHaveBeenCalledTimes(2);
      expect(overlay.apply).toHaveBeenLastCalledWith(expect.anything(), micSnapshot());
      expect(overlay.restore).not.toHaveBeenCalled();
    });

    it('builds a new break on a restore still owed, so the hidden facecam is never the "before"', async () => {
      const owed: ObsBreakSnapshot = {
        items: new Map([['scene:1', { sceneUuid: 'scene', sceneItemId: 1, enabled: true }]]),
        inputs: new Map(),
      };
      const { overlay, service } = setup(null, { owed });
      overlay.restore.mockResolvedValueOnce(false); // OBS still unreachable at start
      await service.start();

      await service.startBreak('ad', 60);

      expect(overlay.apply).toHaveBeenCalledWith(expect.anything(), owed);
    });

    it('drops an unreadable stored restore rather than failing to start', async () => {
      const { overlay, restoreRepo, service } = setup(null, { owed: new Error('bad JSON') });

      await service.start();
      await service.stop();

      expect(restoreRepo.clear).toHaveBeenCalled();
      expect(overlay.restore).not.toHaveBeenCalled();
    });
  });
});
