import { injectable, singleton } from 'tsyringe';
import { EventBus } from '../core/EventBus.js';
import { Logger } from '../utils/Logger.js';
import type { RewardRedemption } from './interfaces/IRewardHandler.js';
import { RewardRegistry } from './RewardRegistry.js';

/**
 * Routes each channel point redemption to the handler registered for its reward title, the way
 * ChatRouter routes `chat.command` to commands.
 *
 * A redemption with no handler is normal — rewards like "Hydrate!" are for the streamer to act
 * on, not the bot — so it's logged at debug and otherwise ignored.
 */
@injectable()
@singleton()
export class RewardRouter {
  private subscribed = false;
  private logger: Logger;

  constructor(
    private eventBus: EventBus,
    private registry: RewardRegistry,
    logger: Logger
  ) {
    this.logger = logger.child({ component: 'RewardRouter' });
  }

  start(): void {
    if (this.subscribed) return;
    this.subscribed = true;
    this.eventBus.on<RewardRedemption>('twitch.channelpoint.redemption', (redemption) =>
      this.route(redemption)
    );
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
    try {
      await handler.handle(redemption);
    } catch (error) {
      this.logger.error(`Reward handler "${redemption.rewardTitle}" failed`, error);
    }
  }
}
