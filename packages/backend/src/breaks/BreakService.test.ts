import 'reflect-metadata';
import { StreamingPlatform } from '@turingmod/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../core/EventBus.js';
import type { SettingsRepository } from '../database/repositories/SettingsRepository.js';
import type { StreamControlService } from '../platforms/StreamControlService.js';
import { Logger } from '../utils/Logger.js';
import { BreakService, type StreamBreakEvent } from './BreakService.js';
import type { ObsBreakOverlay, ObsBreakSnapshot } from './ObsBreakOverlay.js';

const emptySnapshot = (): ObsBreakSnapshot => ({ items: new Map(), inputs: new Map() });

function setup(stored: unknown = null) {
  const eventBus = new EventBus(new Logger({ level: 'silent' }));
  const overlay = {
    apply: vi.fn(() => Promise.resolve(emptySnapshot())),
    restore: vi.fn(() => Promise.resolve()),
  };
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
  const settingsRepo = { getJson: vi.fn(() => Promise.resolve(stored)) };
  const service = new BreakService(
    eventBus,
    settingsRepo as unknown as SettingsRepository,
    overlay as unknown as ObsBreakOverlay,
    streamControl as unknown as StreamControlService,
    new Logger({ level: 'silent' })
  );
  return { eventBus, overlay, streamControl, posted, service };
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

    await eventBus.emit('twitch.ad.break', { durationSeconds: 90 });

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
    finishApply(emptySnapshot());
    await first;

    expect(second.extended).toBe(true);
    expect(overlay.apply).toHaveBeenCalledOnce();
  });

  it('restores with the snapshot taken at the start', async () => {
    const { overlay, service } = setup();
    const snapshot = emptySnapshot();
    snapshot.inputs.set('Mic/Aux', false);
    overlay.apply.mockResolvedValueOnce(snapshot);
    await service.start();

    await service.startBreak('manual', 60);
    await service.endBreak();

    expect(overlay.restore).toHaveBeenCalledWith(snapshot);
  });

  it('ignores Twitch ad breaks when automatic breaks are disabled', async () => {
    const { eventBus, overlay, service } = setup({ enabled: false });
    await service.start();

    await eventBus.emit('twitch.ad.break', { durationSeconds: 90 });

    expect(overlay.apply).not.toHaveBeenCalled();
  });

  it('emits started and ended events', async () => {
    const { eventBus, service } = setup();
    const started = vi.fn();
    const ended = vi.fn();
    eventBus.on<StreamBreakEvent>('stream.break.started', started);
    eventBus.on<StreamBreakEvent>('stream.break.ended', ended);
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
    await eventBus.emit('twitch.ad.break', { durationSeconds: 90 });
    expect(overlay.apply).toHaveBeenCalledOnce(); // no longer listening
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
});
