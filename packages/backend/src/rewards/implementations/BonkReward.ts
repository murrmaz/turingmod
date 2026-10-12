import { injectable } from 'tsyringe';
import { FacecamEffectRunner } from '../../effects/FacecamEffectRunner.js';
import { squish } from '../../effects/facecam/facecamEffects.js';
import { CLIPS } from '../../sounds/clips.js';
import { SoundLibrary } from '../../sounds/SoundLibrary.js';
import type { IRewardHandler, RewardDefinition } from '../interfaces/IRewardHandler.js';

/** Lets the bonk sound land before the facecam reacts to it. */
export const BONK_REACTION_DELAY_MS = 750;

/**
 * Plays the bonk sound and squashes the facecam for ten seconds, alternating between flattening
 * it and pinching it thin on successive bonks. The squash is the point, so a missing sound is
 * logged rather than refunded.
 */
@injectable()
export default class BonkReward implements IRewardHandler {
  readonly rewardTitle = 'Bonk';
  readonly reward: RewardDefinition = { cost: 500, pauseDuringBreaks: true };

  private bonks = 0;

  constructor(
    private sounds: SoundLibrary,
    private effects: FacecamEffectRunner
  ) {}

  async handle(): Promise<void> {
    const direction = this.bonks++ % 2 === 0 ? 'flat' : 'thin';
    await this.sounds.tryPlay(CLIPS.bonk);
    await new Promise((resolve) => setTimeout(resolve, BONK_REACTION_DELAY_MS));
    await this.effects.run(squish(direction));
  }
}
