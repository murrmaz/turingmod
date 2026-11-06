import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fake } from '../../../testing.js';
import type { FacecamEffectRunner } from '../../effects/FacecamEffectRunner.js';
import type { SoundLibrary } from '../../sounds/SoundLibrary.js';
import BonkReward, { BONK_REACTION_DELAY_MS } from './BonkReward.js';

describe('BonkReward', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('plays the bonk sound, then squashes the facecam, alternating direction', async () => {
    const sounds = { tryPlay: vi.fn(() => Promise.resolve()) };
    const effects = { run: vi.fn(() => Promise.resolve()) };
    const bonk = new BonkReward(fake<SoundLibrary>()(sounds), fake<FacecamEffectRunner>()(effects));

    const first = bonk.handle();
    await vi.advanceTimersByTimeAsync(0);
    expect(sounds.tryPlay).toHaveBeenCalledWith('bonk.mp3');
    expect(effects.run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(BONK_REACTION_DELAY_MS);
    await first;

    const second = bonk.handle();
    await vi.advanceTimersByTimeAsync(BONK_REACTION_DELAY_MS);
    await second;

    expect(effects.run.mock.calls.map((call) => (call as unknown[])[0])).toMatchObject([
      { name: 'Bonk (flat)' },
      { name: 'Bonk (thin)' },
    ]);
  });
});
