import { injectable } from 'tsyringe';
import { stretch } from '../../effects/facecam/facecamEffects.js';
import { FacecamEffectReward } from '../FacecamEffectReward.js';
import type { RewardDefinition } from '../interfaces/IRewardHandler.js';

/** Stretches the facecam tall for ten seconds. */
@injectable()
export default class LongPopeReward extends FacecamEffectReward {
  readonly rewardTitle = 'Long Pope';
  readonly reward: RewardDefinition = { cost: 500, pauseDuringBreaks: true };
  protected readonly effect = stretch('long');
}
