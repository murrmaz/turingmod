import 'reflect-metadata';
import { IntegrationStatus, PlatformCapability, StreamingPlatform } from '@turingmod/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../core/EventBus.js';
import { Logger } from '../utils/Logger.js';
import { InvalidStreamInfoError } from './errors.js';
import type {
  ChannelPage,
  DeclaredCapability,
  IStreamPlatform,
  LiveBroadcast,
  StreamInfo,
} from './interfaces/IStreamPlatform.js';
import { PlatformRegistry } from './PlatformRegistry.js';
import { StreamControlService } from './StreamControlService.js';

/** A façade whose availability and live state the test drives directly. */
class FakePlatform implements IStreamPlatform {
  readonly declaredCapabilities = new Set<DeclaredCapability>([
    PlatformCapability.SEND_CHAT,
    PlatformCapability.SET_TITLE,
  ]);
  setStreamInfo = vi.fn<(info: Partial<StreamInfo>) => Promise<void>>(() => Promise.resolve());
  sendChatMessage = vi.fn<(message: string) => Promise<void>>(() => Promise.resolve());

  constructor(
    readonly platform: StreamingPlatform,
    private unavailable: string | null,
    private live: boolean
  ) {}

  getUnavailableReason(): string | null {
    return this.unavailable;
  }
  isLive(): Promise<boolean> {
    return Promise.resolve(this.live);
  }
  getStreamInfo(): Promise<StreamInfo> {
    return Promise.resolve({ title: 'x' });
  }
  getLiveBroadcast(): Promise<LiveBroadcast | null> {
    return Promise.resolve(this.live ? { startedAt: null } : null);
  }
  getChannelPage(): Promise<ChannelPage> {
    return Promise.resolve({ displayName: 'x', url: 'https://example.com/x' });
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

const makeService = (registry: PlatformRegistry, logger: Logger = makeLogger()) =>
  new StreamControlService(registry, new EventBus(new Logger({ level: 'silent' })), logger);

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
    const service = makeService(registry, logger);

    const result = await service.setTitle('New title');

    expect(twitch.setStreamInfo).not.toHaveBeenCalled();
    // Nothing for chat to see: the auth problem stays out of MirrorResult entirely.
    expect(result).toEqual({ updated: [], failures: [] });
    expect(logger.warn).toHaveBeenCalledWith('Skipping Twitch for set_title: Token refresh failed');
  });

  it('logs an offline skip at debug, not as a warning', async () => {
    registry.register(new FakePlatform(StreamingPlatform.TWITCH, null, false));
    const service = makeService(registry, logger);

    await service.setTitle('New title');

    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith('Skipping Twitch for set_title: not broadcasting');
  });

  it('still mirrors to the healthy platforms when one is unavailable', async () => {
    const twitch = new FakePlatform(StreamingPlatform.TWITCH, 'Authorization revoked', true);
    const youtube = new FakePlatform(StreamingPlatform.YOUTUBE, null, true);
    registry.register(twitch);
    registry.register(youtube);
    const service = makeService(registry, logger);

    const result = await service.setTitle('New title');

    expect(result.updated).toEqual([StreamingPlatform.YOUTUBE]);
    expect(youtube.setStreamInfo).toHaveBeenCalledWith({ title: 'New title' });
    expect(twitch.setStreamInfo).not.toHaveBeenCalled();
  });

  it('publishes which platforms a change was applied to, and nothing when none took it', async () => {
    registry.register(new FakePlatform(StreamingPlatform.TWITCH, null, true));
    registry.register(new FakePlatform(StreamingPlatform.YOUTUBE, null, false));
    const eventBus = new EventBus(new Logger({ level: 'silent' }));
    const changed = vi.fn();
    eventBus.on('stream.info.changed', changed);
    const service = new StreamControlService(registry, eventBus, logger);

    await service.setTitle('New title');
    await service.setGame('Celeste');

    expect(changed).toHaveBeenCalledTimes(1);
    expect(changed).toHaveBeenCalledWith({ platforms: [StreamingPlatform.TWITCH] });
  });

  it('marks a failure about the value asked for, and only that one', async () => {
    const twitch = new FakePlatform(StreamingPlatform.TWITCH, null, true);
    const youtube = new FakePlatform(StreamingPlatform.YOUTUBE, null, true);
    twitch.setStreamInfo.mockRejectedValue(new InvalidStreamInfoError('Game not found: Nope'));
    youtube.setStreamInfo.mockRejectedValue(new Error('quota exceeded'));
    registry.register(twitch);
    registry.register(youtube);

    const result = await makeService(registry, logger).setTitle('New title');

    expect(result.failures).toEqual([
      { platform: StreamingPlatform.TWITCH, error: 'Game not found: Nope', invalidValue: true },
      { platform: StreamingPlatform.YOUTUBE, error: 'quota exceeded' },
    ]);
  });

  it('refuses a capability the platform does not have', () => {
    registry.register(new FakePlatform(StreamingPlatform.TWITCH, null, true));
    const service = makeService(registry, logger);

    expect(() => service.require(StreamingPlatform.TWITCH, 'schedule')).toThrow(
      'Twitch does not support schedule'
    );
  });

  it("hands out a platform's capability object", () => {
    const twitch = new FakePlatform(StreamingPlatform.TWITCH, null, true);
    const schedule = { getSchedule: () => Promise.resolve([]) };
    registry.register(Object.assign(twitch, { schedule }));
    const service = makeService(registry, logger);

    expect(service.require(StreamingPlatform.TWITCH, 'schedule')).toBe(schedule);
    expect(service.supports(StreamingPlatform.TWITCH, PlatformCapability.SCHEDULE)).toBe(true);
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
    const service = makeService(registry, logger);

    const result = await service.announce((platform) => `hello ${platform}`);

    expect(twitch.sendChatMessage).toHaveBeenCalledWith('hello twitch');
    expect(youtube.sendChatMessage).not.toHaveBeenCalled();
    expect(result).toEqual({ updated: [StreamingPlatform.TWITCH], failures: [] });
  });

  it('skips a platform whose message is null without counting it', async () => {
    const twitch = new FakePlatform(StreamingPlatform.TWITCH, null, true);
    registry.register(twitch);
    const service = makeService(registry, logger);

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
    const service = makeService(registry, logger);

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

describe('StreamControlService announcements', () => {
  class AnnouncingPlatform extends FakePlatform {
    announcements = {
      sendAnnouncement: vi.fn<(message: string) => Promise<void>>(() => Promise.resolve()),
    };
  }

  it('highlights the message where the platform can, and posts it plainly elsewhere', async () => {
    const registry = new PlatformRegistry();
    const twitch = new AnnouncingPlatform(StreamingPlatform.TWITCH, null, true);
    const youtube = new FakePlatform(StreamingPlatform.YOUTUBE, null, true);
    registry.register(twitch);
    registry.register(youtube);
    const service = makeService(registry);

    await service.announce(() => 'Follow me', { highlight: true });

    expect(twitch.announcements.sendAnnouncement).toHaveBeenCalledWith('Follow me');
    expect(twitch.sendChatMessage).not.toHaveBeenCalled();
    expect(youtube.sendChatMessage).toHaveBeenCalledWith('Follow me');
  });

  it('posts plainly unless asked to highlight', async () => {
    const registry = new PlatformRegistry();
    const twitch = new AnnouncingPlatform(StreamingPlatform.TWITCH, null, true);
    registry.register(twitch);

    await makeService(registry).announce(() => 'Hello');

    expect(twitch.sendChatMessage).toHaveBeenCalledWith('Hello');
    expect(twitch.announcements.sendAnnouncement).not.toHaveBeenCalled();
  });
});
