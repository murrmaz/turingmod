import { injectable } from 'tsyringe';
import { FacecamEffectRunner } from '../../effects/FacecamEffectRunner.js';
import { australia } from '../../effects/facecam/facecamEffects.js';
import type { IRewardHandler, RewardDefinition } from '../interfaces/IRewardHandler.js';

/** Flips the facecam upside down for ten seconds. */
@injectable()
export default class AustraliaReward implements IRewardHandler {
  readonly rewardTitle = 'Australia';
  readonly reward: RewardDefinition = { cost: 500, pauseDuringBreaks: true };

  constructor(private effects: FacecamEffectRunner) {}

  handle(): Promise<void> {
    return this.effects.run(australia);
  }
}
