import { IntegrationStatus, StreamingPlatform } from '@turingmod/shared';
import { injectable, singleton } from 'tsyringe';
import { EventBus } from '../core/EventBus.js';
import { NotAuthenticatedError } from '../platforms/errors.js';
import type {
  ChannelReward,
  ChannelRewardChanges,
  ChannelRewardSettings,
} from '../platforms/interfaces/IStreamPlatform.js';
import { StreamControlService } from '../platforms/StreamControlService.js';
import { Logger } from '../utils/Logger.js';
import type { IRewardHandler } from './interfaces/IRewardHandler.js';
import { RewardRegistry } from './RewardRegistry.js';

/** Payload of `integration:status` (see IntegrationManager.register). */
interface IntegrationStatusEvent {
  name: string;
  status: IntegrationStatus;
}

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
 * Runs when the Twitch API connects (startup, and again after re-authorization) and whenever a
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
@injectable()
@singleton()
export class RewardSync {
  private inBreak = false;
  private managedIds = new Set<string>();
  private reportedUnmanageable = new Set<string>();
  private running: Promise<void> | null = null;
  private rerun = false;
  private started = false;
  private logger: Logger;

  constructor(
    private eventBus: EventBus,
    private registry: RewardRegistry,
    private streamControl: StreamControlService,
    logger: Logger
  ) {
    this.logger = logger.child({ component: 'RewardSync' });
  }

  start(): void {
    if (this.started) return;
    this.started = true;

    this.eventBus.on<IntegrationStatusEvent>('integration:status', (event) => {
      if (event.name === 'twitch-api' && event.status === IntegrationStatus.CONNECTED) {
        void this.requestSync();
      }
    });
    // Not awaited by the break: pausing rewards mustn't hold up the break's own reply.
    this.eventBus.on('stream.break.started', () => {
      this.inBreak = true;
      void this.requestSync();
    });
    // Awaited by the break, so the shutdown path (Application.stop() ends a running break before
    // stopping integrations) unpauses rewards while Twitch is still connected.
    this.eventBus.on('stream.break.ended', () => {
      this.inBreak = false;
      return this.requestSync();
    });
  }

  /** True if the reward was created by TuringMod, so its redemptions can be resolved. */
  isManaged(rewardId: string): boolean {
    return this.managedIds.has(rewardId);
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
      rewards = await this.streamControl.getChannelRewards(StreamingPlatform.TWITCH);
    } catch (error) {
      if (error instanceof NotAuthenticatedError) {
        this.logger.debug('Twitch is not connected; rewards will sync once it is');
      } else {
        this.logger.error('Could not read channel point rewards from Twitch', error);
      }
      return;
    }

    for (const handler of handlers) {
      try {
        await this.syncReward(handler, rewards);
      } catch (error) {
        this.logger.error(`Failed to sync reward "${handler.rewardTitle}"`, error);
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
      const created = await this.streamControl.createChannelReward(
        StreamingPlatform.TWITCH,
        desired
      );
      this.managedIds.add(created.id);
      this.logger.info(`Created channel point reward "${title}"`);
      if (shouldPause) {
        await this.update(created.id, title, { isPaused: true });
      }
      return;
    }

    if (!existing.manageable) {
      if (!this.reportedUnmanageable.has(title)) {
        this.reportedUnmanageable.add(title);
        this.logger.warn(
          `Reward "${title}" was created by another application, so TuringMod can't update it, ` +
            'resolve its redemptions, or pause it during breaks. Delete it on Twitch and ' +
            'TuringMod will create its own on the next sync.'
        );
      }
      return;
    }
    this.reportedUnmanageable.delete(title);
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
    await this.streamControl.updateChannelReward(StreamingPlatform.TWITCH, id, changes);
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
