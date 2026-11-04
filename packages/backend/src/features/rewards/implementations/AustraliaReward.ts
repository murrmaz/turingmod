import { injectable } from 'tsyringe';
import { australia } from '../../effects/facecam/facecamEffects.js';
import { FacecamEffectReward } from '../FacecamEffectReward.js';
import type { RewardDefinition } from '../interfaces/IRewardHandler.js';

/** Flips the facecam upside down for ten seconds. */
@injectable()
export default class AustraliaReward extends FacecamEffectReward {
  readonly rewardTitle = 'Australia';
  readonly reward: RewardDefinition = { cost: 500, pauseDuringBreaks: true };
  protected readonly effect = australia;
}
