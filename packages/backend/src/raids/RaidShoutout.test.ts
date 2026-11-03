import 'reflect-metadata';
import { StreamingPlatform } from '@turingmod/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../core/EventBus.js';
import type { ServiceErrorEvent } from '../core/events.js';
import type { ShoutoutApi, ShoutoutResult } from '../platforms/interfaces/IStreamPlatform.js';
import type { StreamControlService } from '../platforms/StreamControlService.js';
import { fakeRequire } from '../platforms/testing.js';
import type { Logger } from '../utils/Logger.js';
import { RaidShoutout, raidShoutoutMessage } from './RaidShoutout.js';

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

const raid = {
  fromBroadcasterId: 'raider-id',
  fromBroadcasterName: 'coolraider',
  fromBroadcasterDisplayName: 'CoolRaider',
  viewers: 12,
};

describe('RaidShoutout', () => {
  let logger: ReturnType<typeof makeLogger>;
  let eventBus: EventBus;
  let reported: ReturnType<typeof vi.fn<(event: ServiceErrorEvent) => void>>;
  let streamControl: {
    sendChatMessage: ReturnType<typeof vi.fn<StreamControlService['sendChatMessage']>>;
    require: StreamControlService['require'];
  };
  let shoutout: ReturnType<typeof vi.fn<ShoutoutApi['shoutout']>>;

  beforeEach(() => {
    logger = makeLogger();
    eventBus = new EventBus(logger);
    reported = vi.fn<(event: ServiceErrorEvent) => void>();
    eventBus.on('service.error', reported);
    shoutout = vi.fn(() => Promise.resolve<ShoutoutResult>({ sent: true }));
    streamControl = {
      sendChatMessage: vi.fn(() => Promise.resolve()),
      require: fakeRequire(StreamingPlatform.TWITCH, { shoutout: { shoutout } }),
    };
    new RaidShoutout(eventBus, streamControl as unknown as StreamControlService, logger).start();
  });

  it('posts the shoutout message in Twitch chat and sends a native shoutout', async () => {
    await eventBus.emit('twitch.raid', raid);

    expect(streamControl.sendChatMessage).toHaveBeenCalledWith(
      StreamingPlatform.TWITCH,
      raidShoutoutMessage('coolraider')
    );
    expect(shoutout).toHaveBeenCalledWith('coolraider');
  });

  it('links the raider by login name', () => {
    expect(raidShoutoutMessage('coolraider')).toContain('https://www.twitch.tv/coolraider');
  });

  it('still sends the native shoutout when the chat message fails', async () => {
    streamControl.sendChatMessage.mockRejectedValue(new Error('chat down'));

    await eventBus.emit('twitch.raid', raid);

    expect(shoutout).toHaveBeenCalled();
    expect(reported).toHaveBeenCalledWith({
      service: 'Raid shoutouts',
      message: 'Could not post the raid shoutout for coolraider. chat down',
    });
  });

  it('logs a rate-limited native shoutout as info, not an error', async () => {
    shoutout.mockResolvedValue({
      sent: false,
      reason: 'global_cooldown',
      retryAfterMs: 90_500,
    });

    await eventBus.emit('twitch.raid', raid);

    expect(logger.error).not.toHaveBeenCalled();
    expect(reported).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      'Twitch declined the shoutout for coolraider (global_cooldown; retry in 91s)'
    );
  });

  it('reports a failed native shoutout without throwing', async () => {
    shoutout.mockRejectedValue(new Error('not live'));

    await expect(eventBus.emit('twitch.raid', raid)).resolves.toBeUndefined();
    expect(reported).toHaveBeenCalledWith({
      service: 'Raid shoutouts',
      message: "Could not send Twitch's shoutout for coolraider. not live",
    });
  });

  it('reports one run of failures once, and again after a shoutout works', async () => {
    shoutout.mockRejectedValueOnce(new Error('not live'));
    shoutout.mockRejectedValueOnce(new Error('not live'));
    await eventBus.emit('twitch.raid', raid);
    await eventBus.emit('twitch.raid', raid);
    expect(reported).toHaveBeenCalledOnce();

    await eventBus.emit('twitch.raid', raid);
    shoutout.mockRejectedValueOnce(new Error('not live'));
    await eventBus.emit('twitch.raid', raid);
    expect(reported).toHaveBeenCalledTimes(2);
  });
});
