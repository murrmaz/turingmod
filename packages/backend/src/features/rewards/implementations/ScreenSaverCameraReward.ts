import { injectable } from 'tsyringe';
import { FacecamEffectRunner } from '../../effects/FacecamEffectRunner.js';
import { screensaver } from '../../effects/facecam/facecamEffects.js';
import type { IRewardHandler, RewardDefinition } from '../interfaces/IRewardHandler.js';

/** Bounces the facecam around the screen like a DVD screensaver for thirty seconds. */
@injectable()
export default class ScreenSaverCameraReward implements IRewardHandler {
  readonly rewardTitle = 'Screen Saver Camera';
  readonly reward: RewardDefinition = {
    cost: 1000,
    prompt: 'Turn my face cam into a DVD screen saver',
    pauseDuringBreaks: true,
  };

  constructor(private effects: FacecamEffectRunner) {}

  handle(): Promise<void> {
    return this.effects.run(screensaver);
  }
}
