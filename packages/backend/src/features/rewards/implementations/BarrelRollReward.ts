import { injectable } from 'tsyringe';
import { barrelRoll } from '../../effects/facecam/facecamEffects.js';
import { FacecamEffectReward } from '../FacecamEffectReward.js';
import type { RewardDefinition } from '../interfaces/IRewardHandler.js';

/** Spins the facecam through a full turn. */
@injectable()
export default class BarrelRollReward extends FacecamEffectReward {
  readonly rewardTitle = 'Barrel Roll';
  readonly reward: RewardDefinition = { cost: 500, pauseDuringBreaks: true };
  protected readonly effect = barrelRoll;
}
