import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { injectable } from 'tsyringe';
import { EventBus } from '../../core/EventBus.js';
import { FacecamEffectRunner } from '../../effects/FacecamEffectRunner.js';
import { squish } from '../../effects/facecam/facecamEffects.js';
import type { IRewardHandler, RewardDefinition } from '../interfaces/IRewardHandler.js';

/** Lets the bonk sound land before the facecam reacts to it. */
export const BONK_REACTION_DELAY_MS = 750;

/**
 * Plays the bonk sound and squashes the facecam for ten seconds, alternating between flattening
 * it and pinching it thin on successive bonks.
 */
@injectable()
export default class BonkReward implements IRewardHandler {
  readonly rewardTitle = 'Bonk';
  readonly reward: RewardDefinition = { cost: 500, pauseDuringBreaks: true };

  private bonks = 0;
  private soundPath: string;

  constructor(
    private eventBus: EventBus,
    private effects: FacecamEffectRunner
  ) {
    const dirname = fileURLToPath(new URL('.', import.meta.url));
    this.soundPath = join(dirname, '..', '..', '..', 'data', 'bonk.mp3');
  }

  async handle(): Promise<void> {
    const direction = this.bonks++ % 2 === 0 ? 'flat' : 'thin';
    this.eventBus.emitSync('sound.play', { filePath: this.soundPath });
    await new Promise((resolve) => setTimeout(resolve, BONK_REACTION_DELAY_MS));
    await this.effects.run(squish(direction));
  }
}
