import { injectable } from 'tsyringe';
import { FacecamEffectRunner } from '../../effects/FacecamEffectRunner.js';
import { stretch } from '../../effects/facecam/facecamEffects.js';
import type { IRewardHandler, RewardDefinition } from '../interfaces/IRewardHandler.js';

/** Stretches the facecam sideways for ten seconds. */
@injectable()
export default class WidePopeReward implements IRewardHandler {
  readonly rewardTitle = 'Wide Pope';
  readonly reward: RewardDefinition = { cost: 500, pauseDuringBreaks: true };

  constructor(private effects: FacecamEffectRunner) {}

  handle(): Promise<void> {
    return this.effects.run(stretch('wide'));
  }
}
