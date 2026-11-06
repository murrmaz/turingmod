import 'reflect-metadata';
import { IntegrationStatus, StreamingPlatform } from '@turingmod/shared';
import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/EventBus.js';
import type { PlatformAvailabilityEvent } from '../core/events.js';
import { fake, silentLogger } from '../testing.js';
import type { IStreamPlatform } from './interfaces/IStreamPlatform.js';
import { PlatformAvailability } from './PlatformAvailability.js';
import { PlatformRegistry } from './PlatformRegistry.js';

function setup() {
  const logger = silentLogger();
  const bus = new EventBus(logger);
  const registry = new PlatformRegistry();
  const reasons = new Map<StreamingPlatform, string | null>([
    [StreamingPlatform.TWITCH, 'Not connected to Twitch'],
    [StreamingPlatform.YOUTUBE, 'Not connected to YouTube'],
  ]);
  for (const platform of reasons.keys()) {
    registry.register(
      fake<IStreamPlatform>()({
        platform,
        getUnavailableReason: () => reasons.get(platform) ?? null,
      })
    );
  }
  new PlatformAvailability(bus, registry, logger).start();

  const published: PlatformAvailabilityEvent[] = [];
  bus.on('platform.availability', (event) => {
    published.push(event);
  });
  /** Change a façade's answer, then report some status change, as an integration would. */
  const change = (platform: StreamingPlatform, reason: string | null) => {
    reasons.set(platform, reason);
    bus.emitSync('integration.status', { name: 'any', status: IntegrationStatus.CONNECTED });
  };
  return { published, change };
}

describe('PlatformAvailability', () => {
  it('publishes when a platform becomes available and when it stops being available', () => {
    const { published, change } = setup();

    change(StreamingPlatform.TWITCH, null);
    change(StreamingPlatform.TWITCH, 'Twitch authorization expired');

    expect(published).toEqual([
      { platform: StreamingPlatform.TWITCH, available: true, reason: null },
      {
        platform: StreamingPlatform.TWITCH,
        available: false,
        reason: 'Twitch authorization expired',
      },
    ]);
  });

  it('publishes only transitions, not every status change', () => {
    const { published, change } = setup();

    change(StreamingPlatform.TWITCH, null);
    change(StreamingPlatform.TWITCH, null);
    change(StreamingPlatform.YOUTUBE, 'Still not connected to YouTube');

    expect(published).toHaveLength(1);
  });
});
