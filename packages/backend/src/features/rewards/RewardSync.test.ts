import 'reflect-metadata';
import { StreamingPlatform } from '@turingmod/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../core/EventBus.js';
import type { ServiceErrorEvent } from '../../core/events.js';
import { NotAuthenticatedError } from '../../platforms/errors.js';
import type {
  ChannelPointsApi,
  ChannelReward,
  ChannelRewardSettings,
} from '../../platforms/interfaces/IStreamPlatform.js';
import type { StreamControlService } from '../../platforms/StreamControlService.js';
import { fakeRequire } from '../../platforms/testing.js';
import { fake, silentLogger } from '../../testing.js';
import type { IRewardHandler, RewardDefinition } from './interfaces/IRewardHandler.js';
import { RewardRegistry } from './RewardRegistry.js';
import { RewardSync, rewardSettingsFor } from './RewardSync.js';

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
  let logger: ReturnType<typeof silentLogger>;
  let eventBus: EventBus;
  let reported: ReturnType<typeof vi.fn<(event: ServiceErrorEvent) => void>>;
  let registry: RewardRegistry;
  let rewards: ChannelReward[];
  let channelPoints: {
    getChannelRewards: ReturnType<typeof vi.fn<ChannelPointsApi['getChannelRewards']>>;
    createChannelReward: ReturnType<typeof vi.fn<ChannelPointsApi['createChannelReward']>>;
    updateChannelReward: ReturnType<typeof vi.fn<ChannelPointsApi['updateChannelReward']>>;
  };
  let sync: RewardSync;

  const barrelRoll = handler('Barrel Roll', { cost: 500, pauseDuringBreaks: true });
  const banAWord = handler('Ban A Word', {
    cost: 100000,
    prompt: 'Bans a SINGLE word for a single month',
    userInputRequired: true,
  });

  beforeEach(() => {
    logger = silentLogger();
    eventBus = new EventBus(logger);
    reported = vi.fn<(event: ServiceErrorEvent) => void>();
    eventBus.on('service.error', reported);
    registry = new RewardRegistry(logger);
    rewards = [];
    channelPoints = {
      getChannelRewards: vi.fn(() => Promise.resolve(rewards)),
      createChannelReward: vi.fn((settings) =>
        Promise.resolve(onTwitch(`new-${settings.title}`, settings))
      ),
      updateChannelReward: vi.fn(() => Promise.resolve()),
    };
    const streamControl = { require: fakeRequire(StreamingPlatform.TWITCH, { channelPoints }) };
    sync = new RewardSync(eventBus, registry, fake<StreamControlService>()(streamControl), logger);
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

    expect(channelPoints.createChannelReward).toHaveBeenCalledWith(rewardSettingsFor(banAWord));
    expect(await sync.isManaged('new-Ban A Word')).toBe(true);
  });

  it('leaves a reward that already matches its definition untouched', async () => {
    registry.register(banAWord);
    rewards = [onTwitch('r1', rewardSettingsFor(banAWord))];

    await sync.requestSync();

    expect(channelPoints.createChannelReward).not.toHaveBeenCalled();
    expect(channelPoints.updateChannelReward).not.toHaveBeenCalled();
    expect(await sync.isManaged('r1')).toBe(true);
  });

  it('corrects only the settings that drifted', async () => {
    registry.register(banAWord);
    rewards = [
      onTwitch('r1', { ...rewardSettingsFor(banAWord), cost: 50, globalCooldownSeconds: 60 }),
    ];

    await sync.requestSync();

    expect(channelPoints.updateChannelReward).toHaveBeenCalledWith('r1', {
      cost: 100000,
      globalCooldownSeconds: null,
    });
  });

  it('never re-enables a reward the streamer switched off', async () => {
    registry.register(banAWord);
    rewards = [onTwitch('r1', rewardSettingsFor(banAWord), { isEnabled: false })];

    await sync.requestSync();

    expect(channelPoints.updateChannelReward).not.toHaveBeenCalled();
  });

  it("reports a reward another application created once, and doesn't touch it", async () => {
    registry.register(banAWord);
    rewards = [onTwitch('r1', { ...rewardSettingsFor(banAWord), cost: 1 }, { manageable: false })];

    await sync.requestSync();
    await sync.requestSync();

    expect(channelPoints.createChannelReward).not.toHaveBeenCalled();
    expect(channelPoints.updateChannelReward).not.toHaveBeenCalled();
    expect(await sync.isManaged('r1')).toBe(false);
    expect(reported).toHaveBeenCalledOnce();
    expect(reported.mock.calls[0]?.[0].message).toContain(
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
    await vi.waitFor(() => expect(channelPoints.updateChannelReward).toHaveBeenCalled());

    expect(channelPoints.updateChannelReward).toHaveBeenCalledTimes(1);
    expect(channelPoints.updateChannelReward).toHaveBeenCalledWith('roll', { isPaused: true });

    rewards = [
      onTwitch('roll', rewardSettingsFor(barrelRoll), { isPaused: true }),
      onTwitch('ban', rewardSettingsFor(banAWord)),
    ];
    channelPoints.updateChannelReward.mockClear();
    await eventBus.emit('stream.break.ended', { reason: 'ad', durationSeconds: 90 });

    expect(channelPoints.updateChannelReward).toHaveBeenCalledWith('roll', { isPaused: false });
  });

  it('unpauses a reward left paused by a break that never ended (e.g. a crash)', async () => {
    registry.register(barrelRoll);
    rewards = [onTwitch('roll', rewardSettingsFor(barrelRoll), { isPaused: true })];

    await sync.requestSync();

    expect(channelPoints.updateChannelReward).toHaveBeenCalledWith('roll', { isPaused: false });
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
    expect(channelPoints.getChannelRewards).not.toHaveBeenCalled();

    eventBus.emitSync('platform.availability', {
      platform: StreamingPlatform.TWITCH,
      available: true,
      reason: null,
    });

    await vi.waitFor(() => expect(channelPoints.getChannelRewards).toHaveBeenCalledOnce());
  });

  it('coalesces requests made during a pass into one more pass', async () => {
    registry.register(banAWord);
    let release: () => void = () => {};
    channelPoints.getChannelRewards.mockImplementationOnce(
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

    expect(channelPoints.getChannelRewards).toHaveBeenCalledTimes(2);
  });

  it('does nothing without handlers', async () => {
    await sync.requestSync();

    expect(channelPoints.getChannelRewards).not.toHaveBeenCalled();
  });

  it('waits quietly for Twitch to connect', async () => {
    registry.register(banAWord);
    channelPoints.getChannelRewards.mockRejectedValue(
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
    channelPoints.createChannelReward.mockRejectedValueOnce(new Error('DUPLICATE_REWARD'));

    await sync.requestSync();

    expect(channelPoints.createChannelReward).toHaveBeenCalledTimes(2);
    expect(reported).toHaveBeenCalledOnce();
    expect(reported.mock.calls[0]?.[0].message).toMatch(
      /Could not update the "Barrel Roll" reward.*DUPLICATE_REWARD/
    );
  });

  it('reports a reward that keeps failing once, and again if it fails after recovering', async () => {
    registry.register(barrelRoll);
    channelPoints.createChannelReward.mockRejectedValueOnce(new Error('one'));
    channelPoints.createChannelReward.mockRejectedValueOnce(new Error('two'));

    await sync.requestSync();
    await sync.requestSync();
    expect(reported).toHaveBeenCalledOnce();

    await sync.requestSync(); // the create works this time
    channelPoints.getChannelRewards.mockResolvedValueOnce([]);
    channelPoints.createChannelReward.mockRejectedValueOnce(new Error('three'));
    await sync.requestSync();
    expect(reported).toHaveBeenCalledTimes(2);
  });

  it('reports rewards it cannot read once, but stays quiet when Twitch simply is not connected', async () => {
    registry.register(barrelRoll);
    channelPoints.getChannelRewards.mockRejectedValueOnce(
      new NotAuthenticatedError(StreamingPlatform.TWITCH, false, 'Not connected')
    );
    await sync.requestSync();
    expect(reported).not.toHaveBeenCalled();

    channelPoints.getChannelRewards.mockRejectedValueOnce(new Error('503'));
    channelPoints.getChannelRewards.mockRejectedValueOnce(new Error('503'));
    await sync.requestSync();
    await sync.requestSync();

    expect(reported).toHaveBeenCalledOnce();
    expect(reported.mock.calls[0]?.[0].message).toMatch(
      /Could not read channel point rewards.*503/
    );
  });

  describe('whether a reward is managed', () => {
    it('retries a sync that failed, so a failed first sync strands no redemption', async () => {
      registry.register(banAWord);
      rewards = [onTwitch('r1', rewardSettingsFor(banAWord))];
      channelPoints.getChannelRewards.mockRejectedValueOnce(new Error('Twitch answered 503'));
      await sync.requestSync();

      expect(await sync.isManaged('r1')).toBe(true);
      expect(channelPoints.getChannelRewards).toHaveBeenCalledTimes(2);
    });

    it('is not known while Twitch still cannot be read', async () => {
      registry.register(banAWord);
      channelPoints.getChannelRewards.mockRejectedValue(new Error('Twitch answered 503'));

      expect(await sync.isManaged('r1')).toBeNull();
    });

    it('waits for a pass that is running, which may be about to create the reward', async () => {
      registry.register(banAWord);

      const pass = sync.requestSync();
      const managed = sync.isManaged('new-Ban A Word');
      await pass;

      expect(await managed).toBe(true);
      expect(channelPoints.getChannelRewards).toHaveBeenCalledOnce();
    });

    it("doesn't read Twitch again once a pass has", async () => {
      registry.register(banAWord);
      await sync.requestSync();
      channelPoints.getChannelRewards.mockClear();

      expect(await sync.isManaged('someone-elses')).toBe(false);
      expect(channelPoints.getChannelRewards).not.toHaveBeenCalled();
    });
  });
});
