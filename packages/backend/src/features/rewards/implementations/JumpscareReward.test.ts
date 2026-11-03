import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { CLIPS } from '../../sounds/clips.js';
import type { SoundLibrary } from '../../sounds/SoundLibrary.js';
import AmericanJumpscareReward from './AmericanJumpscareReward.js';
import JumpscareReward, { JUMPSCARE_MS } from './JumpscareReward.js';

const library = () => ({ play: vi.fn(() => Promise.resolve()) });

describe('jumpscare rewards', () => {
  it('Jumpscare plays two seconds of one of the jumpscare clips', async () => {
    const sounds = library();
    const reward = new JumpscareReward(sounds as unknown as SoundLibrary);

    for (const random of [0, 0.5, 0.999]) {
      vi.spyOn(Math, 'random').mockReturnValue(random);
      await reward.handle();
    }

    const played = sounds.play.mock.calls.map((call) => (call as unknown[])[0]);
    expect(played).toEqual(['jumpscare_1.mp3', 'jumpscare_3.mp3', 'jumpscare_5.mp3']);
    expect(sounds.play).toHaveBeenCalledWith(expect.any(String), { maxDurationMs: JUMPSCARE_MS });
    vi.restoreAllMocks();
  });

  it('American Jumpscare plays two seconds of a gunshot', async () => {
    const sounds = library();

    await new AmericanJumpscareReward(sounds as unknown as SoundLibrary).handle();

    expect(sounds.play).toHaveBeenCalledWith(CLIPS.gunshot, { maxDurationMs: JUMPSCARE_MS });
  });

  it('fails, so the redemption is refunded, when the clip can not play', async () => {
    const sounds = { play: vi.fn(() => Promise.reject(new Error('Sound clip not found'))) };

    await expect(new JumpscareReward(sounds as unknown as SoundLibrary).handle()).rejects.toThrow(
      'Sound clip not found'
    );
  });
});
