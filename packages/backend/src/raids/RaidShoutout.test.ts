import 'reflect-metadata';
import { StreamingPlatform } from '@turingmod/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../core/EventBus.js';
import type { ShoutoutResult } from '../platforms/interfaces/IStreamPlatform.js';
import type { StreamControlService } from '../platforms/StreamControlService.js';
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
  fromBroadcasterName: 'coolraider',
  fromBroadcasterDisplayName: 'CoolRaider',
  viewers: 12,
};

describe('RaidShoutout', () => {
  let logger: ReturnType<typeof makeLogger>;
  let eventBus: EventBus;
  let streamControl: {
    sendChatMessage: ReturnType<typeof vi.fn<StreamControlService['sendChatMessage']>>;
    shoutout: ReturnType<typeof vi.fn<StreamControlService['shoutout']>>;
  };

  beforeEach(() => {
    logger = makeLogger();
    eventBus = new EventBus(logger);
    streamControl = {
      sendChatMessage: vi.fn(() => Promise.resolve()),
      shoutout: vi.fn(() => Promise.resolve<ShoutoutResult>({ sent: true })),
    };
    new RaidShoutout(eventBus, streamControl as unknown as StreamControlService, logger).start();
  });

  it('posts the shoutout message in Twitch chat and sends a native shoutout', async () => {
    await eventBus.emit('twitch.raid', raid);

    expect(streamControl.sendChatMessage).toHaveBeenCalledWith(
      StreamingPlatform.TWITCH,
      raidShoutoutMessage('coolraider')
    );
    expect(streamControl.shoutout).toHaveBeenCalledWith(StreamingPlatform.TWITCH, 'coolraider');
  });

  it('links the raider by login name', () => {
    expect(raidShoutoutMessage('coolraider')).toContain('https://www.twitch.tv/coolraider');
  });

  it('still sends the native shoutout when the chat message fails', async () => {
    streamControl.sendChatMessage.mockRejectedValue(new Error('chat down'));

    await eventBus.emit('twitch.raid', raid);

    expect(streamControl.shoutout).toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      'Failed to post the raid shoutout message for coolraider',
      expect.any(Error)
    );
  });

  it('logs a rate-limited native shoutout as info, not an error', async () => {
    streamControl.shoutout.mockResolvedValue({
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
    streamControl.shoutout.mockRejectedValue(new Error('not live'));

    await expect(eventBus.emit('twitch.raid', raid)).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      'Failed to send the native shoutout for coolraider',
      expect.any(Error)
    );
  });
});
