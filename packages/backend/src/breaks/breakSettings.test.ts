import { StreamingPlatform } from '@turingmod/shared';
import { describe, expect, it } from 'vitest';
import { DEFAULT_BREAK_SETTINGS, parseBreakSettings, renderMessage } from './breakSettings.js';

describe('parseBreakSettings', () => {
  it('returns the defaults when nothing is stored', () => {
    const { settings, problems } = parseBreakSettings(null);
    expect(settings).toEqual(DEFAULT_BREAK_SETTINGS);
    expect(problems).toEqual([]);
  });

  it('keeps valid fields and defaults only the invalid ones', () => {
    const { settings, problems } = parseBreakSettings({
      obs: { hideSources: ['Cam'], muteInputs: 'Mic/Aux' },
      adWarnings: { pollIntervalSeconds: 5 },
    });

    expect(settings.obs.hideSources).toEqual(['Cam']);
    expect(settings.obs.muteInputs).toEqual(DEFAULT_BREAK_SETTINGS.obs.muteInputs);
    expect(settings.adWarnings.pollIntervalSeconds).toBe(
      DEFAULT_BREAK_SETTINGS.adWarnings.pollIntervalSeconds
    );
    expect(problems).toHaveLength(2);
  });

  it('replaces a message wholesale, dropping built-in per-platform overrides', () => {
    const { settings } = parseBreakSettings({
      messages: { adBreakStarted: { default: 'BRB {duration}' } },
    });

    expect(settings.messages.adBreakStarted).toEqual({ default: 'BRB {duration}' });
  });

  it('rejects a message with no default', () => {
    const { settings, problems } = parseBreakSettings({
      messages: { breakEnded: { twitch: 'back' } },
    });

    expect(settings.messages.breakEnded).toEqual(DEFAULT_BREAK_SETTINGS.messages.breakEnded);
    expect(problems).toHaveLength(1);
  });
});

describe('renderMessage', () => {
  const message = {
    default: 'Break for {duration}',
    [StreamingPlatform.TWITCH]: 'Ads for {duration}',
  };

  it('uses the platform override when there is one', () => {
    expect(renderMessage(message, StreamingPlatform.TWITCH, { duration: '3m' })).toBe('Ads for 3m');
  });

  it('falls back to the default', () => {
    expect(renderMessage(message, StreamingPlatform.YOUTUBE, { duration: '3m' })).toBe(
      'Break for 3m'
    );
  });

  it('leaves unknown placeholders alone', () => {
    expect(renderMessage({ default: 'In {time}' }, StreamingPlatform.TWITCH, {})).toBe('In {time}');
  });

  it('returns null for an empty message so the platform is skipped', () => {
    expect(
      renderMessage(
        { default: 'x', [StreamingPlatform.YOUTUBE]: '' },
        StreamingPlatform.YOUTUBE,
        {}
      )
    ).toBeNull();
  });
});
