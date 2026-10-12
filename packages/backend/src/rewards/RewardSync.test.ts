import 'reflect-metadata';
import { StreamingPlatform } from '@turingmod/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../core/EventBus.js';
import { NotAuthenticatedError } from '../platforms/errors.js';
import type {
  ChannelReward,
  ChannelRewardSettings,
} from '../platforms/interfaces/IStreamPlatform.js';
import type { StreamControlService } from '../platforms/StreamControlService.js';
import type { Logger } from '../utils/Logger.js';
import type { IRewardHandler, RewardDefinition } from './interfaces/IRewardHandler.js';
import { RewardRegistry } from './RewardRegistry.js';
import { RewardSync, rewardSettingsFor } from './RewardSync.js';

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

const handler = (rewardTitle: string, reward: RewardDefinition): IRewardHandler => ({
  rewardTitle,
  reward,
  handle: () => Promise.resolve(),
});

/** A reward on Twitch that matches `settings` exactly. */
const onTwitch = (
  id: string,
  settings: ChannelRewardSettings,
  overrides: Partial<ChannelReward> = {}
): ChannelReward => ({
  id,
  ...settings,
  isEnabled: true,
  isPaused: false,
  manageable: true,
  ...overrides,
});

describe('RewardSync', () => {
  let logger: ReturnType<typeof makeLogger>;
  let eventBus: EventBus;
  let registry: RewardRegistry;
  let rewards: ChannelReward[];
  let streamControl: {
    getChannelRewards: ReturnType<typeof vi.fn<StreamControlService['getChannelRewards']>>;
    createChannelReward: ReturnType<typeof vi.fn<StreamControlService['createChannelReward']>>;
    updateChannelReward: ReturnType<typeof vi.fn<StreamControlService['updateChannelReward']>>;
  };
  let sync: RewardSync;

  const barrelRoll = handler('Barrel Roll', { cost: 500, pauseDuringBreaks: true });
  const banAWord = handler('Ban A Word', {
    cost: 100000,
    prompt: 'Bans a SINGLE word for a single month',
    userInputRequired: true,
  });

  beforeEach(() => {
    logger = makeLogger();
    eventBus = new EventBus(logger);
    registry = new RewardRegistry(logger);
    rewards = [];
    streamControl = {
      getChannelRewards: vi.fn(() => Promise.resolve(rewards)),
      createChannelReward: vi.fn((_platform, settings) =>
        Promise.resolve(onTwitch(`new-${settings.title}`, settings))
      ),
      updateChannelReward: vi.fn(() => Promise.resolve()),
    };
    sync = new RewardSync(
      eventBus,
      registry,
      streamControl as unknown as StreamControlService,
      logger
    );
    sync.start();
  });

  it('turns unset definition fields off', () => {
    expect(rewardSettingsFor(barrelRoll)).toEqual({
      title: 'Barrel Roll',
      cost: 500,
      prompt: '',
      userInputRequired: false,
      globalCooldownSeconds: null,
      maxPerStream: null,
      maxPerUserPerStream: null,
      autoFulfill: false,
    });
  });

  it('creates a missing reward from its definition and then manages it', async () => {
    registry.register(banAWord);

    await sync.requestSync();

    expect(streamControl.createChannelReward).toHaveBeenCalledWith(
      StreamingPlatform.TWITCH,
      rewardSettingsFor(banAWord)
    );
    expect(sync.isManaged('new-Ban A Word')).toBe(true);
  });

  it('leaves a reward that already matches its definition untouched', async () => {
    registry.register(banAWord);
    rewards = [onTwitch('r1', rewardSettingsFor(banAWord))];

    await sync.requestSync();

    expect(streamControl.createChannelReward).not.toHaveBeenCalled();
    expect(streamControl.updateChannelReward).not.toHaveBeenCalled();
    expect(sync.isManaged('r1')).toBe(true);
  });

  it('corrects only the settings that drifted', async () => {
    registry.register(banAWord);
    rewards = [
      onTwitch('r1', { ...rewardSettingsFor(banAWord), cost: 50, globalCooldownSeconds: 60 }),
    ];

    await sync.requestSync();

    expect(streamControl.updateChannelReward).toHaveBeenCalledWith(StreamingPlatform.TWITCH, 'r1', {
      cost: 100000,
      globalCooldownSeconds: null,
    });
  });

  it('never re-enables a reward the streamer switched off', async () => {
    registry.register(banAWord);
    rewards = [onTwitch('r1', rewardSettingsFor(banAWord), { isEnabled: false })];

    await sync.requestSync();

    expect(streamControl.updateChannelReward).not.toHaveBeenCalled();
  });

  it("reports a reward another application created once, and doesn't touch it", async () => {
    registry.register(banAWord);
    rewards = [onTwitch('r1', { ...rewardSettingsFor(banAWord), cost: 1 }, { manageable: false })];

    await sync.requestSync();
    await sync.requestSync();

    expect(streamControl.createChannelReward).not.toHaveBeenCalled();
    expect(streamControl.updateChannelReward).not.toHaveBeenCalled();
    expect(sync.isManaged('r1')).toBe(false);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0]?.[0]).toContain(
      '"Ban A Word" was created by another application'
    );
  });

  it('pauses rewards that ask for it while a break runs, and unpauses them after', async () => {
    registry.register(barrelRoll);
    registry.register(banAWord);
    rewards = [
      onTwitch('roll', rewardSettingsFor(barrelRoll)),
      onTwitch('ban', rewardSettingsFor(banAWord)),
    ];

    // A break start doesn't wait for the sync, so wait for its update to land.
    await eventBus.emit('stream.break.started', { reason: 'ad', durationSeconds: 90 });
    await vi.waitFor(() => expect(streamControl.updateChannelReward).toHaveBeenCalled());

    expect(streamControl.updateChannelReward).toHaveBeenCalledTimes(1);
    expect(streamControl.updateChannelReward).toHaveBeenCalledWith(
      StreamingPlatform.TWITCH,
      'roll',
      { isPaused: true }
    );

    rewards = [
      onTwitch('roll', rewardSettingsFor(barrelRoll), { isPaused: true }),
      onTwitch('ban', rewardSettingsFor(banAWord)),
    ];
    streamControl.updateChannelReward.mockClear();
    await eventBus.emit('stream.break.ended', { reason: 'ad', durationSeconds: 90 });

    expect(streamControl.updateChannelReward).toHaveBeenCalledWith(
      StreamingPlatform.TWITCH,
      'roll',
      { isPaused: false }
    );
  });

  it('unpauses a reward left paused by a break that never ended (e.g. a crash)', async () => {
    registry.register(barrelRoll);
    rewards = [onTwitch('roll', rewardSettingsFor(barrelRoll), { isPaused: true })];

    await sync.requestSync();

    expect(streamControl.updateChannelReward).toHaveBeenCalledWith(
      StreamingPlatform.TWITCH,
      'roll',
      { isPaused: false }
    );
  });

  it('syncs when Twitch becomes available', async () => {
    registry.register(banAWord);

    eventBus.emitSync('platform.availability', {
      platform: StreamingPlatform.TWITCH,
      available: false,
      reason: 'Twitch authorization expired',
    });
    eventBus.emitSync('platform.availability', {
      platform: StreamingPlatform.YOUTUBE,
      available: true,
      reason: null,
    });
    expect(streamControl.getChannelRewards).not.toHaveBeenCalled();

    eventBus.emitSync('platform.availability', {
      platform: StreamingPlatform.TWITCH,
      available: true,
      reason: null,
    });

    await vi.waitFor(() => expect(streamControl.getChannelRewards).toHaveBeenCalledOnce());
  });

  it('coalesces requests made during a pass into one more pass', async () => {
    registry.register(banAWord);
    let release: () => void = () => {};
    streamControl.getChannelRewards.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve(rewards);
        })
    );

    const first = sync.requestSync();
    void sync.requestSync();
    void sync.requestSync();
    release();
    await first;

    expect(streamControl.getChannelRewards).toHaveBeenCalledTimes(2);
  });

  it('does nothing without handlers', async () => {
    await sync.requestSync();

    expect(streamControl.getChannelRewards).not.toHaveBeenCalled();
  });

  it('waits quietly for Twitch to connect', async () => {
    registry.register(banAWord);
    streamControl.getChannelRewards.mockRejectedValue(
      new NotAuthenticatedError(StreamingPlatform.TWITCH, false, 'Not connected')
    );

    await sync.requestSync();

    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith(
      'Twitch is not connected; rewards will sync once it is'
    );
  });

  it('keeps syncing the other rewards when one fails', async () => {
    registry.register(barrelRoll);
    registry.register(banAWord);
    streamControl.createChannelReward.mockRejectedValueOnce(new Error('DUPLICATE_REWARD'));

    await sync.requestSync();

    expect(streamControl.createChannelReward).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledWith(
      'Failed to sync reward "Barrel Roll"',
      expect.any(Error)
    );
  });
});
