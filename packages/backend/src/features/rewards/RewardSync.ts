import { StreamingPlatform } from '@turingmod/shared';
import { singleton } from 'tsyringe';
import { EventBus } from '../../core/EventBus.js';
import {
  type IService,
  type RepeatingFailures,
  repeatingFailures,
  Subscriptions,
} from '../../core/ServiceLifecycle.js';
import { NotAuthenticatedError } from '../../platforms/errors.js';
import type {
  ChannelReward,
  ChannelRewardChanges,
  ChannelRewardSettings,
} from '../../platforms/interfaces/IStreamPlatform.js';
import { StreamControlService } from '../../platforms/StreamControlService.js';
import { Logger } from '../../utils/Logger.js';
import type { IRewardHandler } from './interfaces/IRewardHandler.js';
import { RewardRegistry } from './RewardRegistry.js';

/** Settings compared on every sync. The title is how a reward is found, so it never differs. */
const SYNCED_FIELDS = [
  'cost',
  'prompt',
  'userInputRequired',
  'globalCooldownSeconds',
  'maxPerStream',
  'maxPerUserPerStream',
  'autoFulfill',
] as const satisfies readonly (keyof ChannelRewardSettings)[];

/** The Twitch settings a handler's definition asks for, with unset fields turned off. */
export function rewardSettingsFor(handler: IRewardHandler): ChannelRewardSettings {
  const { reward } = handler;
  return {
    title: handler.rewardTitle,
    cost: reward.cost,
    prompt: reward.prompt ?? '',
    userInputRequired: reward.userInputRequired ?? false,
    globalCooldownSeconds: reward.globalCooldownSeconds ?? null,
    maxPerStream: reward.maxPerStream ?? null,
    maxPerUserPerStream: reward.maxPerUserPerStream ?? null,
    autoFulfill: reward.autoFulfill ?? false,
  };
}

/**
 * Keeps each reward handler's channel point reward in step with its definition: created when
 * missing, corrected when its settings drift, and paused during stream breaks if it asks to be.
 *
 * Runs when Twitch becomes available (startup, and again after re-authorization) and whenever a
 * break starts or ends. Each pass compares against what Twitch currently has, so it is safe to
 * repeat; requests that arrive mid-pass are coalesced into one more pass.
 *
 * Twitch only lets the application that created a reward edit it. A same-titled reward made in
 * the dashboard or by another bot still triggers its handler, but is reported and left alone —
 * the streamer deletes it and the next pass creates one TuringMod owns.
 *
 * `isEnabled` is never changed on an existing reward, so the streamer can switch rewards off in
 * the dashboard without TuringMod turning them back on.
 */
@singleton()
export class RewardSync implements IService {
  private subscriptions = new Subscriptions();
  private inBreak = false;
  private managedIds = new Set<string>();
  /** Whether a pass has read Twitch's rewards, without which managedIds says nothing. */
  private synced = false;
  private running: Promise<void> | null = null;
  private rerun = false;
  private logger: Logger;
  /** Passes repeat, on every break among other things, so each problem is reported once. */
  private failures: RepeatingFailures;

  constructor(
    private eventBus: EventBus,
    private registry: RewardRegistry,
    private streamControl: StreamControlService,
    logger: Logger
  ) {
    this.logger = logger.child({ component: 'RewardSync' });
    this.failures = repeatingFailures(eventBus, this.logger, 'Channel point rewards');
  }

  start(): void {
    this.subscriptions.add(
      this.eventBus.on('platform.availability', (event) => {
        if (event.platform === StreamingPlatform.TWITCH && event.available) {
          void this.requestSync();
        }
      }),
      // Not awaited by the break: pausing rewards mustn't hold up the break's own reply.
      this.eventBus.on('stream.break.started', () => {
        this.inBreak = true;
        void this.requestSync();
      }),
      // Awaited by the break, so the shutdown path (BreakService stops before this does, and
      // both before integrations) unpauses rewards while Twitch is still connected.
      this.eventBus.on('stream.break.ended', () => {
        this.inBreak = false;
        return this.requestSync();
      })
    );
  }

  stop(): void {
    this.subscriptions.clear();
  }

  /**
   * Whether the reward was created by TuringMod, so its redemptions can be resolved. Waits for a
   * pass that is running, and runs one if none has read Twitch's rewards yet, which also retries a
   * sync that failed. Null if that failed too, so the answer isn't known. Never rejects.
   */
  async isManaged(rewardId: string): Promise<boolean | null> {
    await this.running;
    if (!this.synced) {
      await this.requestSync();
    }
    return this.synced ? this.managedIds.has(rewardId) : null;
  }

  /**
   * Run a pass, or if one is already running, have it go round once more when it finishes.
   * Resolves when no pass is left to run. Never rejects.
   */
  requestSync(): Promise<void> {
    if (this.running) {
      this.rerun = true;
      return this.running;
    }
    this.running = (async () => {
      try {
        do {
          this.rerun = false;
          await this.syncOnce();
        } while (this.rerun);
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  private async syncOnce(): Promise<void> {
    const handlers = this.registry.getAll();
    if (handlers.length === 0) return;

    let rewards: ChannelReward[];
    try {
      rewards = await this.streamControl
        .require(StreamingPlatform.TWITCH, 'channelPoints')
        .getChannelRewards();
    } catch (error) {
      if (error instanceof NotAuthenticatedError) {
        this.logger.debug('Twitch is not connected; rewards will sync once it is');
      } else {
        this.failures.failed(
          'read',
          "Could not read channel point rewards from Twitch, so they aren't being kept in step.",
          error
        );
      }
      return;
    }
    this.failures.recovered('read');
    this.synced = true;

    for (const handler of handlers) {
      try {
        await this.syncReward(handler, rewards);
        this.failures.recovered(`sync:${handler.rewardTitle}`);
      } catch (error) {
        this.failures.failed(
          `sync:${handler.rewardTitle}`,
          `Could not update the "${handler.rewardTitle}" reward on Twitch.`,
          error
        );
      }
    }
  }

  private async syncReward(handler: IRewardHandler, rewards: ChannelReward[]): Promise<void> {
    const title = handler.rewardTitle;
    const desired = rewardSettingsFor(handler);
    const pausable = handler.reward.pauseDuringBreaks === true;
    const shouldPause = pausable && this.inBreak;
    const existing = rewards.find((reward) => reward.title === title);

    if (!existing) {
      const created = await this.streamControl
        .require(StreamingPlatform.TWITCH, 'channelPoints')
        .createChannelReward(desired);
      this.managedIds.add(created.id);
      this.logger.info(`Created channel point reward "${title}"`);
      if (shouldPause) {
        await this.update(created.id, title, { isPaused: true });
      }
      return;
    }

    if (!existing.manageable) {
      this.failures.failed(
        `unmanageable:${title}`,
        `Reward "${title}" was created by another application, so TuringMod can't update it, ` +
          'resolve its redemptions, or pause it during breaks. Delete it on Twitch and ' +
          'TuringMod will create its own on the next sync.'
      );
      return;
    }
    this.failures.recovered(`unmanageable:${title}`);
    this.managedIds.add(existing.id);

    const changes: ChannelRewardChanges = changedSettings(existing, desired);
    if (pausable && existing.isPaused !== shouldPause) {
      changes.isPaused = shouldPause;
    }
    if (Object.keys(changes).length > 0) {
      await this.update(existing.id, title, changes);
    }
  }

  private async update(id: string, title: string, changes: ChannelRewardChanges): Promise<void> {
    await this.streamControl
      .require(StreamingPlatform.TWITCH, 'channelPoints')
      .updateChannelReward(id, changes);
    this.logger.info(`Updated channel point reward "${title}": ${Object.keys(changes).join(', ')}`);
  }
}

/** The synced settings where Twitch's reward differs from the definition. */
function changedSettings(
  existing: ChannelReward,
  desired: ChannelRewardSettings
): Partial<ChannelRewardSettings> {
  const changes: Partial<Record<keyof ChannelRewardSettings, unknown>> = {};
  for (const key of SYNCED_FIELDS) {
    if (existing[key] !== desired[key]) {
      changes[key] = desired[key];
    }
  }
  return changes as Partial<ChannelRewardSettings>;
}
