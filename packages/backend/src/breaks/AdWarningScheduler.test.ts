import 'reflect-metadata';
import { StreamingPlatform } from '@turingmod/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../core/EventBus.js';
import type { PlatformRegistry } from '../platforms/PlatformRegistry.js';
import type { StreamControlService } from '../platforms/StreamControlService.js';
import { Logger } from '../utils/Logger.js';
import { AdWarningScheduler } from './AdWarningScheduler.js';
import type { BreakService } from './BreakService.js';
import { type BreakSettings, DEFAULT_BREAK_SETTINGS } from './breakSettings.js';

const MINUTE = 60_000;

function setup(settings: BreakSettings = DEFAULT_BREAK_SETTINGS) {
  const eventBus = new EventBus(new Logger({ level: 'silent' }));
  let nextAdAt: number | null = Date.now() + 10 * MINUTE;
  const posted: { twitch: string | null; youtube: string | null }[] = [];
  const streamControl = {
    getNextAdBreak: vi.fn(() =>
      Promise.resolve(nextAdAt === null ? null : { nextAdDate: new Date(nextAdAt) })
    ),
    announce: vi.fn((messageFor: (p: StreamingPlatform) => string | null) => {
      posted.push({
        twitch: messageFor(StreamingPlatform.TWITCH),
        youtube: messageFor(StreamingPlatform.YOUTUBE),
      });
      return Promise.resolve({ updated: [], failures: [] });
    }),
  };
  let unavailable: string | null = null;
  const registry = {
    get: vi.fn(() => ({ getUnavailableReason: () => unavailable })),
  };
  const breakService = { getSettings: () => settings };
  const scheduler = new AdWarningScheduler(
    eventBus,
    breakService as unknown as BreakService,
    streamControl as unknown as StreamControlService,
    registry as unknown as PlatformRegistry,
    new Logger({ level: 'silent' })
  );
  return {
    eventBus,
    streamControl,
    posted,
    scheduler,
    setNextAd: (at: number | null) => {
      nextAdAt = at;
    },
    setUnavailable: (reason: string | null) => {
      unavailable = reason;
    },
  };
}

describe('AdWarningScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('warns every platform at 5 minutes and 1 minute before the ad', async () => {
    const { posted, scheduler } = setup();
    scheduler.start();

    await vi.advanceTimersByTimeAsync(5 * MINUTE - 1);
    expect(posted).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1);
    expect(posted[0]).toEqual({
      twitch: 'Heads up: ads will run in 5m. Sorry for the interruption!',
      youtube: 'Heads up: short break in 5m.',
    });

    await vi.advanceTimersByTimeAsync(4 * MINUTE);
    expect(posted[1]?.twitch).toBe('Heads up: ads will run in 1m. Sorry for the interruption!');
    expect(posted).toHaveLength(2);
    scheduler.stop();
  });

  it('does not repeat a warning when periodic polls see the same ad', async () => {
    const { posted, scheduler } = setup();
    scheduler.start();

    await vi.advanceTimersByTimeAsync(9 * MINUTE + 30_000); // several 5-minute polls

    expect(posted).toHaveLength(2);
    scheduler.stop();
  });

  it('reschedules instead of warning when the ad was snoozed', async () => {
    const start = Date.now();
    const { posted, scheduler, setNextAd } = setup();
    scheduler.start();
    await vi.advanceTimersByTimeAsync(MINUTE);

    setNextAd(start + 15 * MINUTE); // snoozed by 5 minutes
    await vi.advanceTimersByTimeAsync(4 * MINUTE); // the original 5-minute warning time

    expect(posted).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(5 * MINUTE); // the new 5-minute warning time
    expect(posted).toHaveLength(1);
    expect(posted[0]?.twitch).toContain('5m');
    scheduler.stop();
  });

  it('skips lead times that have already passed', async () => {
    const { posted, scheduler, setNextAd } = setup();
    setNextAd(Date.now() + 2 * MINUTE);
    scheduler.start();

    await vi.advanceTimersByTimeAsync(2 * MINUTE);

    expect(posted).toHaveLength(1); // only the 1-minute warning
    scheduler.stop();
  });

  it('says nothing when Twitch is offline or unavailable', async () => {
    const { posted, scheduler, setNextAd, setUnavailable, streamControl } = setup();
    setNextAd(null);
    scheduler.start();
    await vi.advanceTimersByTimeAsync(10 * MINUTE);
    expect(posted).toHaveLength(0);

    setUnavailable('Twitch needs re-authorization');
    streamControl.getNextAdBreak.mockClear();
    await vi.advanceTimersByTimeAsync(10 * MINUTE);
    expect(streamControl.getNextAdBreak).not.toHaveBeenCalled();
    scheduler.stop();
  });

  it('does nothing when automatic breaks are disabled', async () => {
    const { posted, scheduler, streamControl } = setup({
      ...DEFAULT_BREAK_SETTINGS,
      enabled: false,
    });
    scheduler.start();

    await vi.advanceTimersByTimeAsync(10 * MINUTE);

    expect(posted).toHaveLength(0);
    expect(streamControl.getNextAdBreak).not.toHaveBeenCalled();
    scheduler.stop();
  });

  it('re-reads the schedule once Twitch becomes available', async () => {
    const { eventBus, scheduler, streamControl } = setup();
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    streamControl.getNextAdBreak.mockClear();

    eventBus.emitSync('platform.availability', {
      platform: StreamingPlatform.TWITCH,
      available: true,
      reason: null,
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(streamControl.getNextAdBreak).toHaveBeenCalledOnce();
    scheduler.stop();
  });

  it('cancels pending warnings when stopped', async () => {
    const { posted, scheduler } = setup();
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);

    scheduler.stop();
    await vi.advanceTimersByTimeAsync(10 * MINUTE);

    expect(posted).toHaveLength(0);
  });
});
