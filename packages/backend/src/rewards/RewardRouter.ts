import { StreamingPlatform } from '@turingmod/shared';
import { injectable, singleton } from 'tsyringe';
import { EventBus } from '../core/EventBus.js';
import type { RedemptionOutcome } from '../platforms/interfaces/IStreamPlatform.js';
import { StreamControlService } from '../platforms/StreamControlService.js';
import { Logger } from '../utils/Logger.js';
import type { RewardRedemption } from './interfaces/IRewardHandler.js';
import { RewardRegistry } from './RewardRegistry.js';
import { RewardSync } from './RewardSync.js';

/**
 * Routes each channel point redemption to the handler registered for its reward title, the way
 * ChatRouter routes each chat command to its command class.
 *
 * A redemption with no handler is normal — rewards like "Hydrate!" are for the streamer to act
 * on, not the bot — so it's logged at debug and otherwise ignored.
 *
 * When the redemption is waiting in the request queue and the reward is one TuringMod created,
 * it's then marked fulfilled if the handler succeeded or canceled — refunding the viewer — if it
 * threw. Rewards made elsewhere are left for the streamer to resolve.
 */
@injectable()
@singleton()
export class RewardRouter {
  private subscribed = false;
  private logger: Logger;

  constructor(
    private eventBus: EventBus,
    private registry: RewardRegistry,
    private sync: RewardSync,
    private streamControl: StreamControlService,
    logger: Logger
  ) {
    this.logger = logger.child({ component: 'RewardRouter' });
  }

  start(): void {
    if (this.subscribed) return;
    this.subscribed = true;
    this.eventBus.on('twitch.channelPoint.redemption', (redemption) => this.route(redemption));
  }

  /** Run the handler for one redemption. Never rejects: a handler failure is logged here. */
  async route(redemption: RewardRedemption): Promise<void> {
    const handler = this.registry.get(redemption.rewardTitle);
    if (!handler) {
      this.logger.debug(`No handler for reward "${redemption.rewardTitle}"`);
      return;
    }

    this.logger.info(
      `Handling reward "${redemption.rewardTitle}" redeemed by ${redemption.userDisplayName}`
    );
    let outcome: RedemptionOutcome = 'fulfilled';
    try {
      await handler.handle(redemption);
    } catch (error) {
      outcome = 'canceled';
      this.logger.error(`Reward handler "${redemption.rewardTitle}" failed`, error);
    }

    if (redemption.status === 'unfulfilled' && this.sync.isManaged(redemption.rewardId)) {
      await this.resolve(redemption, outcome);
    }
  }

  private async resolve(redemption: RewardRedemption, outcome: RedemptionOutcome): Promise<void> {
    try {
      await this.streamControl.resolveRedemption(
        StreamingPlatform.TWITCH,
        redemption.rewardId,
        redemption.id,
        outcome
      );
      if (outcome === 'canceled') {
        this.logger.info(
          `Refunded ${redemption.userDisplayName}'s "${redemption.rewardTitle}" redemption`
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to mark ${redemption.userDisplayName}'s "${redemption.rewardTitle}" redemption ${outcome}`,
        error
      );
    }
  }
}
