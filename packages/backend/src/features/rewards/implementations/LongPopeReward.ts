import { injectable } from 'tsyringe';
import { FacecamEffectRunner } from '../../effects/FacecamEffectRunner.js';
import { stretch } from '../../effects/facecam/facecamEffects.js';
import type { IRewardHandler, RewardDefinition } from '../interfaces/IRewardHandler.js';

/** Stretches the facecam tall for ten seconds. */
@injectable()
export default class LongPopeReward implements IRewardHandler {
  readonly rewardTitle = 'Long Pope';
  readonly reward: RewardDefinition = { cost: 500, pauseDuringBreaks: true };

  constructor(private effects: FacecamEffectRunner) {}

  handle(): Promise<void> {
    return this.effects.run(stretch('long'));
  }
}
