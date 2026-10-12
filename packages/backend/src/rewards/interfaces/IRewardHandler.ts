import type { RewardRedemption } from '../../core/events.js';

export type { RewardRedemption };

/**
 * How a handler's reward is set up on Twitch. RewardSync creates the reward from this when it's
 * missing and corrects it when it drifts, so the definition lives beside the code that acts on
 * it. Unset optional fields mean "off": no prompt, no input, no cooldown, no limits.
 */
export interface RewardDefinition {
  cost: number;
  prompt?: string;
  userInputRequired?: boolean;
  globalCooldownSeconds?: number;
  maxPerStream?: number;
  maxPerUserPerStream?: number;
  /**
   * Skip the request queue. Off by default: queued redemptions are marked fulfilled when the
   * handler succeeds and canceled (refunding the viewer) when it fails, which a redemption that
   * skipped the queue can't be.
   */
  autoFulfill?: boolean;
  /**
   * Pause the reward while a stream break has the streamer off camera, for rewards whose effect
   * nobody would see. Paused rewards stay visible but can't be redeemed.
   */
  pauseDuringBreaks?: boolean;
}

/**
 * What the bot does when a channel point reward is redeemed. One class per reward, in
 * `rewards/implementations/`, auto-discovered by loadRewardHandlers — adding a reward is
 * dropping in one file, the same as adding a command.
 */
export interface IRewardHandler {
  /**
   * The reward's title on Twitch, matched exactly against the redemption. Titles are unique
   * per channel, so this identifies one reward; renaming the reward on Twitch means changing
   * it here too.
   */
  readonly rewardTitle: string;

  /** The reward's settings on Twitch. */
  readonly reward: RewardDefinition;

  /**
   * React to one redemption. Throwing is reported by RewardRouter, refunds a queued redemption,
   * and never stops other redemptions from being handled.
   */
  handle(redemption: RewardRedemption): Promise<void>;
}
