import { injectable } from 'tsyringe';
import { CLIPS } from '../../sounds/clips.js';
import { SoundLibrary } from '../../sounds/SoundLibrary.js';
import type { IRewardHandler, RewardDefinition } from '../interfaces/IRewardHandler.js';
import { JUMPSCARE_MS } from './JumpscareReward.js';

/** Plays the first two seconds of a gunshot. */
@injectable()
export default class AmericanJumpscareReward implements IRewardHandler {
  readonly rewardTitle = 'American Jumpscare';
  // The original bot handled this reward but never created it, so its cost lived only on Twitch.
  // This matches Jumpscare until the real one is known.
  readonly reward: RewardDefinition = { cost: 5000 };

  constructor(private sounds: SoundLibrary) {}

  handle(): Promise<void> {
    return this.sounds.play(CLIPS.gunshot, { maxDurationMs: JUMPSCARE_MS });
  }
}
