import { injectable } from 'tsyringe';
import { screensaver } from '../../effects/facecam/facecamEffects.js';
import { FacecamEffectReward } from '../FacecamEffectReward.js';
import type { RewardDefinition } from '../interfaces/IRewardHandler.js';

/** Bounces the facecam around the screen like a DVD screensaver for thirty seconds. */
@injectable()
export default class ScreenSaverCameraReward extends FacecamEffectReward {
  readonly rewardTitle = 'Screen Saver Camera';
  readonly reward: RewardDefinition = {
    cost: 1000,
    prompt: 'Turn my face cam into a DVD screen saver',
    pauseDuringBreaks: true,
  };
  protected readonly effect = screensaver;
}
