import 'reflect-metadata';
import { StreamingPlatform } from '@turingmod/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../core/EventBus.js';
import type { StreamControlService } from '../platforms/StreamControlService.js';
import type { Logger } from '../utils/Logger.js';
import type { IRewardHandler, RewardRedemption } from './interfaces/IRewardHandler.js';
import { RewardRegistry } from './RewardRegistry.js';
import { RewardRouter } from './RewardRouter.js';
import type { RewardSync } from './RewardSync.js';

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

const redemption = (
  rewardTitle: string,
  status: RewardRedemption['status'] = 'fulfilled'
): RewardRedemption => ({
  id: 'redemption-1',
  rewardId: 'reward-1',
  rewardTitle,
  rewardCost: 100,
  userId: 'user-1',
  userName: 'viewer',
  userDisplayName: 'Viewer',
  input: '',
  status,
  redeemedAt: new Date(0),
});

const handlerFor = (rewardTitle: string, handle = vi.fn(() => Promise.resolve())) =>
  ({ rewardTitle, reward: { cost: 100 }, handle }) satisfies IRewardHandler;

describe('RewardRouter', () => {
  let logger: ReturnType<typeof makeLogger>;
  let eventBus: EventBus;
  let registry: RewardRegistry;
  let router: RewardRouter;
  let managed: boolean;
  let streamControl: {
    resolveRedemption: ReturnType<typeof vi.fn<StreamControlService['resolveRedemption']>>;
  };

  beforeEach(() => {
    logger = makeLogger();
    eventBus = new EventBus(logger);
    registry = new RewardRegistry(logger);
    managed = true;
    streamControl = { resolveRedemption: vi.fn(() => Promise.resolve()) };
    const sync = { isManaged: () => managed } as unknown as RewardSync;
    router = new RewardRouter(
      eventBus,
      registry,
      sync,
      streamControl as unknown as StreamControlService,
      logger
    );
    router.start();
  });

  it('runs the handler registered for the redeemed reward title', async () => {
    const barrelRoll = handlerFor('Barrel Roll');
    const bonk = handlerFor('Bonk');
    registry.register(barrelRoll);
    registry.register(bonk);

    const event = redemption('Barrel Roll');
    await eventBus.emit('twitch.channelpoint.redemption', event);

    expect(barrelRoll.handle).toHaveBeenCalledWith(event);
    expect(bonk.handle).not.toHaveBeenCalled();
  });

  it('matches titles exactly', async () => {
    const bonk = handlerFor('Bonk');
    registry.register(bonk);

    await eventBus.emit('twitch.channelpoint.redemption', redemption('bonk'));

    expect(bonk.handle).not.toHaveBeenCalled();
  });

  it('ignores a reward with no handler, which is for the streamer to act on', async () => {
    await eventBus.emit('twitch.channelpoint.redemption', redemption('Hydrate!'));

    expect(logger.debug).toHaveBeenCalledWith('No handler for reward "Hydrate!"');
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('logs a failing handler and keeps routing later redemptions', async () => {
    const failing = handlerFor(
      'Jumpscare',
      vi.fn(() => Promise.reject(new Error('sound missing')))
    );
    const bonk = handlerFor('Bonk');
    registry.register(failing);
    registry.register(bonk);

    await eventBus.emit('twitch.channelpoint.redemption', redemption('Jumpscare'));
    await eventBus.emit('twitch.channelpoint.redemption', redemption('Bonk'));

    expect(logger.error).toHaveBeenCalledWith(
      'Reward handler "Jumpscare" failed',
      expect.any(Error)
    );
    expect(bonk.handle).toHaveBeenCalledTimes(1);
  });

  it('marks a queued redemption fulfilled once its handler succeeds', async () => {
    registry.register(handlerFor('Bonk'));

    await eventBus.emit('twitch.channelpoint.redemption', redemption('Bonk', 'unfulfilled'));

    expect(streamControl.resolveRedemption).toHaveBeenCalledWith(
      StreamingPlatform.TWITCH,
      'reward-1',
      'redemption-1',
      'fulfilled'
    );
  });

  it('cancels, refunding the viewer, a queued redemption whose handler fails', async () => {
    registry.register(
      handlerFor(
        'Bonk',
        vi.fn(() => Promise.reject(new Error('OBS down')))
      )
    );

    await eventBus.emit('twitch.channelpoint.redemption', redemption('Bonk', 'unfulfilled'));

    expect(streamControl.resolveRedemption).toHaveBeenCalledWith(
      StreamingPlatform.TWITCH,
      'reward-1',
      'redemption-1',
      'canceled'
    );
    expect(logger.info).toHaveBeenCalledWith('Refunded Viewer\'s "Bonk" redemption');
  });

  it('leaves redemptions that skipped the queue alone', async () => {
    registry.register(handlerFor('Bonk'));

    await eventBus.emit('twitch.channelpoint.redemption', redemption('Bonk', 'fulfilled'));

    expect(streamControl.resolveRedemption).not.toHaveBeenCalled();
  });

  it('leaves redemptions of rewards another application created for the streamer', async () => {
    managed = false;
    registry.register(handlerFor('Bonk'));

    await eventBus.emit('twitch.channelpoint.redemption', redemption('Bonk', 'unfulfilled'));

    expect(streamControl.resolveRedemption).not.toHaveBeenCalled();
  });

  it('logs a failure to resolve the redemption without throwing', async () => {
    streamControl.resolveRedemption.mockRejectedValue(new Error('403'));
    registry.register(handlerFor('Bonk'));

    await eventBus.emit('twitch.channelpoint.redemption', redemption('Bonk', 'unfulfilled'));

    expect(logger.error).toHaveBeenCalledWith(
      'Failed to mark Viewer\'s "Bonk" redemption fulfilled',
      expect.any(Error)
    );
  });

  it('subscribes once however many times it is started', async () => {
    const bonk = handlerFor('Bonk');
    registry.register(bonk);
    router.start();

    await eventBus.emit('twitch.channelpoint.redemption', redemption('Bonk'));

    expect(bonk.handle).toHaveBeenCalledTimes(1);
  });
});

describe('RewardRegistry', () => {
  it('rejects two handlers for one reward title', () => {
    const registry = new RewardRegistry(makeLogger());
    registry.register(handlerFor('Bonk'));

    expect(() => registry.register(handlerFor('Bonk'))).toThrow(
      'Reward handler already registered: Bonk'
    );
  });
});
