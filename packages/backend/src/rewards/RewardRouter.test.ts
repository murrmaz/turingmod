import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../core/EventBus.js';
import type { Logger } from '../utils/Logger.js';
import type { IRewardHandler, RewardRedemption } from './interfaces/IRewardHandler.js';
import { RewardRegistry } from './RewardRegistry.js';
import { RewardRouter } from './RewardRouter.js';

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

const redemption = (rewardTitle: string): RewardRedemption => ({
  id: 'redemption-1',
  rewardId: 'reward-1',
  rewardTitle,
  rewardCost: 100,
  userId: 'user-1',
  userName: 'viewer',
  userDisplayName: 'Viewer',
  input: '',
  status: 'fulfilled',
  redeemedAt: new Date(0),
});

const handlerFor = (rewardTitle: string, handle = vi.fn(() => Promise.resolve())) =>
  ({ rewardTitle, handle }) satisfies IRewardHandler;

describe('RewardRouter', () => {
  let logger: ReturnType<typeof makeLogger>;
  let eventBus: EventBus;
  let registry: RewardRegistry;
  let router: RewardRouter;

  beforeEach(() => {
    logger = makeLogger();
    eventBus = new EventBus(logger);
    registry = new RewardRegistry(logger);
    router = new RewardRouter(eventBus, registry, logger);
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
