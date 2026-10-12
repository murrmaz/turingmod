/**
 * A channel point redemption, as published on the EventBus as `twitch.channelpoint.redemption`
 * by TwitchEventSubIntegration.
 */
export interface RewardRedemption {
  /** The redemption's own id — not the reward's. */
  id: string;
  rewardId: string;
  rewardTitle: string;
  rewardCost: number;
  userId: string;
  userName: string;
  userDisplayName: string;
  /** What the viewer typed, for rewards that prompt for text; empty otherwise. */
  input: string;
  /** `unfulfilled` while the reward waits in the request queue, `fulfilled` if it skips it. */
  status: string;
  redeemedAt: Date;
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

  /**
   * React to one redemption. Throwing is reported by RewardRouter and never stops other
   * redemptions from being handled.
   */
  handle(redemption: RewardRedemption): Promise<void>;
}
