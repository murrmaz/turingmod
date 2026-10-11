import 'reflect-metadata';
import { IntegrationStatus, PlatformCapability, StreamingPlatform } from '@turingmod/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '../utils/Logger.js';
import type { IStreamPlatform, StreamInfo } from './interfaces/IStreamPlatform.js';
import { PlatformRegistry } from './PlatformRegistry.js';
import { StreamControlService } from './StreamControlService.js';

/** A façade whose availability and live state the test drives directly. */
class FakePlatform implements IStreamPlatform {
  setStreamInfo = vi.fn<(info: Partial<StreamInfo>) => Promise<void>>(() => Promise.resolve());
  sendChatMessage = vi.fn<(message: string) => Promise<void>>(() => Promise.resolve());

  constructor(
    readonly platform: StreamingPlatform,
    private unavailable: string | null,
    private live: boolean
  ) {}

  getCapabilities(): Set<PlatformCapability> {
    return new Set([PlatformCapability.SEND_CHAT, PlatformCapability.SET_TITLE]);
  }
  getUnavailableReason(): string | null {
    return this.unavailable;
  }
  isLive(): Promise<boolean> {
    return Promise.resolve(this.live);
  }
  getStreamInfo(): Promise<StreamInfo> {
    return Promise.resolve({ title: 'x' });
  }
  getUptime(): Promise<number | null> {
    return Promise.resolve(null);
  }
}

const makeLogger = () => {
  const logger = {
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    child: vi.fn(),
  };
  logger.child.mockReturnValue(logger);
  return logger as unknown as Logger & typeof logger;
};

describe('StreamControlService mirroring', () => {
  let logger: ReturnType<typeof makeLogger>;
  let registry: PlatformRegistry;

  beforeEach(() => {
    logger = makeLogger();
    registry = new PlatformRegistry();
  });

  it('logs a warning and skips a platform whose auth is broken, without reporting a failure', async () => {
    const twitch = new FakePlatform(StreamingPlatform.TWITCH, 'Token refresh failed', true);
    registry.register(twitch);
    const service = new StreamControlService(registry, logger);

    const result = await service.setTitle('New title');

    expect(twitch.setStreamInfo).not.toHaveBeenCalled();
    // Nothing for chat to see: the auth problem stays out of MirrorResult entirely.
    expect(result).toEqual({ updated: [], failures: [] });
    expect(logger.warn).toHaveBeenCalledWith('Skipping Twitch for set_title: Token refresh failed');
  });

  it('logs an offline skip at debug, not as a warning', async () => {
    registry.register(new FakePlatform(StreamingPlatform.TWITCH, null, false));
    const service = new StreamControlService(registry, logger);

    await service.setTitle('New title');

    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith('Skipping Twitch for set_title: not broadcasting');
  });

  it('still mirrors to the healthy platforms when one is unavailable', async () => {
    const twitch = new FakePlatform(StreamingPlatform.TWITCH, 'Authorization revoked', true);
    const youtube = new FakePlatform(StreamingPlatform.YOUTUBE, null, true);
    registry.register(twitch);
    registry.register(youtube);
    const service = new StreamControlService(registry, logger);

    const result = await service.setTitle('New title');

    expect(result.updated).toEqual([StreamingPlatform.YOUTUBE]);
    expect(youtube.setStreamInfo).toHaveBeenCalledWith({ title: 'New title' });
    expect(twitch.setStreamInfo).not.toHaveBeenCalled();
  });

  it('refuses a capability the platform does not advertise', async () => {
    registry.register(new FakePlatform(StreamingPlatform.TWITCH, null, true));
    const service = new StreamControlService(registry, logger);

    await expect(service.getSchedule(StreamingPlatform.TWITCH)).rejects.toThrow(
      'twitch does not support schedule'
    );
  });
});

describe('StreamControlService.announce', () => {
  let logger: ReturnType<typeof makeLogger>;
  let registry: PlatformRegistry;

  beforeEach(() => {
    logger = makeLogger();
    registry = new PlatformRegistry();
  });

  it('posts per-platform wording to every live platform and skips the rest', async () => {
    const twitch = new FakePlatform(StreamingPlatform.TWITCH, null, true);
    const youtube = new FakePlatform(StreamingPlatform.YOUTUBE, null, false);
    registry.register(twitch);
    registry.register(youtube);
    const service = new StreamControlService(registry, logger);

    const result = await service.announce((platform) => `hello ${platform}`);

    expect(twitch.sendChatMessage).toHaveBeenCalledWith('hello twitch');
    expect(youtube.sendChatMessage).not.toHaveBeenCalled();
    expect(result).toEqual({ updated: [StreamingPlatform.TWITCH], failures: [] });
  });

  it('skips a platform whose message is null without counting it', async () => {
    const twitch = new FakePlatform(StreamingPlatform.TWITCH, null, true);
    registry.register(twitch);
    const service = new StreamControlService(registry, logger);

    const result = await service.announce(() => null);

    expect(twitch.sendChatMessage).not.toHaveBeenCalled();
    expect(result).toEqual({ updated: [], failures: [] });
  });

  it('reports a send failure without stopping the other platforms', async () => {
    const twitch = new FakePlatform(StreamingPlatform.TWITCH, null, true);
    const youtube = new FakePlatform(StreamingPlatform.YOUTUBE, null, true);
    twitch.sendChatMessage.mockRejectedValueOnce(new Error('rate limited'));
    registry.register(twitch);
    registry.register(youtube);
    const service = new StreamControlService(registry, logger);

    const result = await service.announce(() => 'hi');

    expect(result.updated).toEqual([StreamingPlatform.YOUTUBE]);
    expect(result.failures).toEqual([
      { platform: StreamingPlatform.TWITCH, error: 'rate limited' },
    ]);
  });
});

describe('unavailableReason wiring', () => {
  it('prefers the integration error message over generic wording', async () => {
    const { unavailableReason } = await import('./availability.js');

    expect(
      unavailableReason(
        {
          getStatus: () => IntegrationStatus.NEEDS_REAUTH,
          getErrorMessage: () => 'Refresh token is invalid or revoked',
        },
        StreamingPlatform.TWITCH
      )
    ).toBe('Refresh token is invalid or revoked');
  });

  it('is null when the integration is connected', async () => {
    const { unavailableReason } = await import('./availability.js');

    expect(
      unavailableReason(
        { getStatus: () => IntegrationStatus.CONNECTED, getErrorMessage: () => undefined },
        StreamingPlatform.YOUTUBE
      )
    ).toBeNull();
  });

  it('names the platform when OAuth was never completed', async () => {
    const { unavailableReason } = await import('./availability.js');

    expect(
      unavailableReason(
        { getStatus: () => IntegrationStatus.DISCONNECTED, getErrorMessage: () => undefined },
        StreamingPlatform.YOUTUBE
      )
    ).toBe('Not connected to YouTube — complete the YouTube OAuth flow first');
  });
});
