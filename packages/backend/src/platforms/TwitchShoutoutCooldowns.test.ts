import { describe, expect, it } from 'vitest';
import { TwitchShoutoutCooldowns } from './TwitchShoutoutCooldowns.js';

const MINUTE = 60 * 1000;

function setup() {
  let now = 1_000_000;
  const cooldowns = new TwitchShoutoutCooldowns(() => now);
  return {
    cooldowns,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('TwitchShoutoutCooldowns', () => {
  it('allows the first shoutout', () => {
    const { cooldowns } = setup();
    expect(cooldowns.check('a')).toBeNull();
  });

  it('refuses any shoutout within 2 minutes of the last one', () => {
    const { cooldowns, advance } = setup();
    cooldowns.record('a');
    advance(90 * 1000);

    expect(cooldowns.check('b')).toEqual({
      sent: false,
      reason: 'global_cooldown',
      retryAfterMs: 30 * 1000,
    });

    advance(30 * 1000);
    expect(cooldowns.check('b')).toBeNull();
  });

  it('refuses the same target within 60 minutes', () => {
    const { cooldowns, advance } = setup();
    cooldowns.record('a');
    advance(10 * MINUTE);

    expect(cooldowns.check('a')).toEqual({
      sent: false,
      reason: 'target_cooldown',
      retryAfterMs: 50 * MINUTE,
    });

    advance(50 * MINUTE);
    expect(cooldowns.check('a')).toBeNull();
  });
});
