import { injectable } from 'tsyringe';
import { FacecamEffectRunner } from '../../effects/FacecamEffectRunner.js';
import { barrelRoll } from '../../effects/facecam/facecamEffects.js';
import type { IRewardHandler, RewardDefinition } from '../interfaces/IRewardHandler.js';

/** Spins the facecam through a full turn. */
@injectable()
export default class BarrelRollReward implements IRewardHandler {
  readonly rewardTitle = 'Barrel Roll';
  readonly reward: RewardDefinition = { cost: 500, pauseDuringBreaks: true };

  constructor(private effects: FacecamEffectRunner) {}

  handle(): Promise<void> {
    return this.effects.run(barrelRoll);
  }
}
