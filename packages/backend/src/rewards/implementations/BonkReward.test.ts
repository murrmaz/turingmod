import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventBus } from '../../core/EventBus.js';
import type { FacecamEffectRunner } from '../../effects/FacecamEffectRunner.js';
import BonkReward, { BONK_REACTION_DELAY_MS } from './BonkReward.js';

describe('BonkReward', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('plays the bonk sound, then squashes the facecam, alternating direction', async () => {
    const eventBus = { emitSync: vi.fn() };
    const effects = { run: vi.fn(() => Promise.resolve()) };
    const bonk = new BonkReward(
      eventBus as unknown as EventBus,
      effects as unknown as FacecamEffectRunner
    );

    const first = bonk.handle();
    expect(eventBus.emitSync).toHaveBeenCalledWith('sound.play', {
      filePath: expect.stringMatching(/bonk\.mp3$/),
    });
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
