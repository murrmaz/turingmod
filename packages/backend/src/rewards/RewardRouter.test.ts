import 'reflect-metadata';
import { StreamingPlatform } from '@turingmod/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../core/EventBus.js';
import type { ServiceErrorEvent } from '../core/events.js';
import type { ChannelPointsApi } from '../platforms/interfaces/IStreamPlatform.js';
import type { StreamControlService } from '../platforms/StreamControlService.js';
import { fakeRequire } from '../platforms/testing.js';
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
  let managed: boolean | null;
  let reported: ReturnType<typeof vi.fn<(event: ServiceErrorEvent) => void>>;
  let resolveRedemption: ReturnType<typeof vi.fn<ChannelPointsApi['resolveRedemption']>>;

  beforeEach(() => {
    logger = makeLogger();
    eventBus = new EventBus(logger);
    registry = new RewardRegistry(logger);
    managed = true;
    resolveRedemption = vi.fn(() => Promise.resolve());
    const streamControl = {
      require: fakeRequire(StreamingPlatform.TWITCH, { channelPoints: { resolveRedemption } }),
    };
    reported = vi.fn<(event: ServiceErrorEvent) => void>();
    eventBus.on('service.error', reported);
    const sync = { isManaged: () => Promise.resolve(managed) } as unknown as RewardSync;
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
    await eventBus.emit('twitch.channelPoint.redemption', event);

    expect(barrelRoll.handle).toHaveBeenCalledWith(event);
    expect(bonk.handle).not.toHaveBeenCalled();
  });

  it('matches titles exactly', async () => {
    const bonk = handlerFor('Bonk');
    registry.register(bonk);

    await eventBus.emit('twitch.channelPoint.redemption', redemption('bonk'));

    expect(bonk.handle).not.toHaveBeenCalled();
  });

  it('ignores a reward with no handler, which is for the streamer to act on', async () => {
    await eventBus.emit('twitch.channelPoint.redemption', redemption('Hydrate!'));

    expect(logger.debug).toHaveBeenCalledWith('No handler for reward "Hydrate!"');
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('reports a failing handler and keeps routing later redemptions', async () => {
    const failing = handlerFor(
      'Jumpscare',
      vi.fn(() => Promise.reject(new Error('sound missing')))
    );
    const bonk = handlerFor('Bonk');
    registry.register(failing);
    registry.register(bonk);

    await eventBus.emit('twitch.channelPoint.redemption', redemption('Jumpscare'));
    await eventBus.emit('twitch.channelPoint.redemption', redemption('Bonk'));

    expect(reported).toHaveBeenCalledOnce();
    expect(reported.mock.calls[0]?.[0].message).toMatch(/"Jumpscare" reward failed for Viewer/);
    expect(bonk.handle).toHaveBeenCalledTimes(1);
  });

  it('marks a queued redemption fulfilled once its handler succeeds', async () => {
    registry.register(handlerFor('Bonk'));

    await eventBus.emit('twitch.channelPoint.redemption', redemption('Bonk', 'unfulfilled'));

    expect(resolveRedemption).toHaveBeenCalledWith('reward-1', 'redemption-1', 'fulfilled');
  });

  it('cancels, refunding the viewer, a queued redemption whose handler fails', async () => {
    registry.register(
      handlerFor(
        'Bonk',
        vi.fn(() => Promise.reject(new Error('OBS down')))
      )
    );

    await eventBus.emit('twitch.channelPoint.redemption', redemption('Bonk', 'unfulfilled'));

    expect(resolveRedemption).toHaveBeenCalledWith('reward-1', 'redemption-1', 'canceled');
    expect(logger.info).toHaveBeenCalledWith('Refunded Viewer\'s "Bonk" redemption');
  });

  it('leaves redemptions that skipped the queue alone', async () => {
    registry.register(handlerFor('Bonk'));

    await eventBus.emit('twitch.channelPoint.redemption', redemption('Bonk', 'fulfilled'));

    expect(resolveRedemption).not.toHaveBeenCalled();
  });

  it('leaves redemptions of rewards another application created for the streamer', async () => {
    managed = false;
    registry.register(handlerFor('Bonk'));

    await eventBus.emit('twitch.channelPoint.redemption', redemption('Bonk', 'unfulfilled'));

    expect(resolveRedemption).not.toHaveBeenCalled();
  });

  it('logs a failure to resolve the redemption without throwing', async () => {
    resolveRedemption.mockRejectedValue(new Error('403'));
    registry.register(handlerFor('Bonk'));

    await eventBus.emit('twitch.channelPoint.redemption', redemption('Bonk', 'unfulfilled'));

    expect(logger.error).toHaveBeenCalledWith(
      'Viewer\'s "Bonk" redemption is still in Twitch\'s request queue: approve it there.',
      expect.any(Error)
    );
  });

  it('stops routing redemptions once stopped', async () => {
    const bonk = handlerFor('Bonk');
    registry.register(bonk);
    router.stop();

    await eventBus.emit('twitch.channelPoint.redemption', redemption('Bonk'));

    expect(bonk.handle).not.toHaveBeenCalled();
  });

  describe('a redemption that should be resolved and cannot be', () => {
    it("tells the streamer when Twitch's rewards can't be read, to refund it by hand", async () => {
      managed = null;
      registry.register(
        handlerFor(
          'Bonk',
          vi.fn(() => Promise.reject(new Error('sound missing')))
        )
      );

      await eventBus.emit('twitch.channelPoint.redemption', redemption('Bonk', 'unfulfilled'));

      expect(resolveRedemption).not.toHaveBeenCalled();
      expect(reported).toHaveBeenCalledWith({
        service: 'Channel point rewards',
        message: expect.stringMatching(/Viewer's "Bonk".*still in.*refund it/),
      });
    });

    it('tells the streamer when Twitch refuses to resolve it, to approve it by hand', async () => {
      resolveRedemption.mockRejectedValue(new Error('Twitch answered 500'));
      registry.register(handlerFor('Bonk'));

      await eventBus.emit('twitch.channelPoint.redemption', redemption('Bonk', 'unfulfilled'));

      expect(reported).toHaveBeenCalledWith({
        service: 'Channel point rewards',
        message: expect.stringMatching(/still in.*approve it.*Twitch answered 500/),
      });
    });

    it("says nothing about a reward TuringMod doesn't own, which is the streamer's anyway", async () => {
      managed = false;
      registry.register(handlerFor('Bonk'));

      await eventBus.emit('twitch.channelPoint.redemption', redemption('Bonk', 'unfulfilled'));

      expect(resolveRedemption).not.toHaveBeenCalled();
      expect(reported).not.toHaveBeenCalled();
    });
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
