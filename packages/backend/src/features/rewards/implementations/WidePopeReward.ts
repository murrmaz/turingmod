import { injectable } from 'tsyringe';
import { stretch } from '../../effects/facecam/facecamEffects.js';
import { FacecamEffectReward } from '../FacecamEffectReward.js';
import type { RewardDefinition } from '../interfaces/IRewardHandler.js';

/** Stretches the facecam sideways for ten seconds. */
@injectable()
export default class WidePopeReward extends FacecamEffectReward {
  readonly rewardTitle = 'Wide Pope';
  readonly reward: RewardDefinition = { cost: 500, pauseDuringBreaks: true };
  protected readonly effect = stretch('wide');
}
