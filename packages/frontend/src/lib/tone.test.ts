import { describe, expect, it } from 'vitest';
import { activityEventTone } from './tone';

describe('activityEventTone', () => {
  it("colours a recorded event's name by its category, and nothing else", () => {
    expect(activityEventTone('command.executed')).toBe('command');
    expect(activityEventTone('integration.error')).toBe('error');
    expect(activityEventTone('twitch.follow')).toBe('viewer');
    expect(activityEventTone('not.an.event')).toBeUndefined();
  });
});
