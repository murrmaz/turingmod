import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { fake } from '../../../testing.js';
import type { FacecamEffectRunner } from '../../effects/FacecamEffectRunner.js';
import AustraliaReward from './AustraliaReward.js';
import BarrelRollReward from './BarrelRollReward.js';
import LongPopeReward from './LongPopeReward.js';
import ScreenSaverCameraReward from './ScreenSaverCameraReward.js';
import WidePopeReward from './WidePopeReward.js';

/**
 * A reward is matched on Twitch by its exact title, so a changed title creates a second reward
 * there rather than renaming this one. Each title is written out for that reason.
 */
const REWARDS = [
  { handler: AustraliaReward, title: 'Australia', cost: 500 },
  { handler: BarrelRollReward, title: 'Barrel Roll', cost: 500 },
  { handler: LongPopeReward, title: 'Long Pope', cost: 500 },
  { handler: WidePopeReward, title: 'Wide Pope', cost: 500 },
  { handler: ScreenSaverCameraReward, title: 'Screen Saver Camera', cost: 1000 },
];

describe.each(REWARDS)('$title reward', ({ handler, title, cost }) => {
  const run = vi.fn(() => Promise.resolve());
  const reward = new handler(fake<FacecamEffectRunner>()({ run }));

  it('keeps its title and cost, and pauses during breaks', () => {
    expect(reward.rewardTitle).toBe(title);
    expect(reward.reward).toMatchObject({ cost, pauseDuringBreaks: true });
  });

  it('plays the effect of the same name, once', async () => {
    run.mockClear();

    await reward.handle();

    expect(run).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ name: title }));
  });

  it('passes on a failure, so the redemption is refunded', async () => {
    run.mockRejectedValueOnce(new Error('OBS is not connected'));

    await expect(reward.handle()).rejects.toThrow('OBS is not connected');
  });
});
