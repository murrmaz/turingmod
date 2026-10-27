import 'reflect-metadata';
import { StreamingPlatform } from '@turingmod/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../core/EventBus.js';
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
  let streamControl: {
    sendChatMessage: ReturnType<typeof vi.fn<StreamControlService['sendChatMessage']>>;
    require: StreamControlService['require'];
  };
  let shoutout: ReturnType<typeof vi.fn<ShoutoutApi['shoutout']>>;

  beforeEach(() => {
    logger = makeLogger();
    eventBus = new EventBus(logger);
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
    expect(logger.error).toHaveBeenCalledWith(
      'Failed to post the raid shoutout message for coolraider',
      expect.any(Error)
    );
  });

  it('logs a rate-limited native shoutout as info, not an error', async () => {
    shoutout.mockResolvedValue({
      sent: false,
      reason: 'global_cooldown',
      retryAfterMs: 90_500,
    });

    await eventBus.emit('twitch.raid', raid);

    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      'Twitch declined the shoutout for coolraider (global_cooldown; retry in 91s)'
    );
  });

  it('logs a failed native shoutout without throwing', async () => {
    shoutout.mockRejectedValue(new Error('not live'));

    await expect(eventBus.emit('twitch.raid', raid)).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      'Failed to send the native shoutout for coolraider',
      expect.any(Error)
    );
  });
});
