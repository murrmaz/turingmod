import { injectable } from 'tsyringe';
import { CLIPS } from '../../sounds/clips.js';
import { SoundLibrary } from '../../sounds/SoundLibrary.js';
import type { IRewardHandler, RewardDefinition } from '../interfaces/IRewardHandler.js';

/** How much of a jumpscare clip plays, as in the original bot. */
export const JUMPSCARE_MS = 2_000;

/** Plays the first two seconds of a random jumpscare clip. */
@injectable()
export default class JumpscareReward implements IRewardHandler {
  readonly rewardTitle = 'Jumpscare';
  readonly reward: RewardDefinition = {
    cost: 5000,
    prompt: 'Just be funny when you hit this please',
  };

  constructor(private sounds: SoundLibrary) {}

  handle(): Promise<void> {
    const clips = CLIPS.jumpscares;
    const clip = clips[Math.floor(Math.random() * clips.length)] ?? clips[0];
    return this.sounds.play(clip, { maxDurationMs: JUMPSCARE_MS });
  }
}
