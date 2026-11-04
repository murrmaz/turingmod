import { injectable } from 'tsyringe';
import type { FacecamEffect } from '../effects/FacecamEffect.js';
import { FacecamEffectRunner } from '../effects/FacecamEffectRunner.js';
import type { IRewardHandler, RewardDefinition } from './interfaces/IRewardHandler.js';

/**
 * A reward that plays one facecam effect. A subclass names the reward and its effect, and is
 * `@injectable()` with no constructor of its own.
 *
 * The decorator here isn't redundant: it's what records this constructor's parameter for
 * subclasses to inherit. Without it tsyringe would build them with no runner at all and startup
 * would still pass, which `boot.smoke.test.ts` checks for. It's cast because `injectable()` is
 * typed not to accept an abstract class.
 */
@(injectable() as ClassDecorator)
export abstract class FacecamEffectReward implements IRewardHandler {
  abstract readonly rewardTitle: string;
  abstract readonly reward: RewardDefinition;
  protected abstract readonly effect: FacecamEffect;

  constructor(private effects: FacecamEffectRunner) {}

  handle(): Promise<void> {
    return this.effects.run(this.effect);
  }
}
