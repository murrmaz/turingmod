import { StreamingPlatform } from '@turingmod/shared';
import { describe, expect, it } from 'vitest';
import { BREAK_SETTINGS, DEFAULT_BREAK_SETTINGS, renderMessage } from './breakSettings.js';

describe('BREAK_SETTINGS', () => {
  const parse = (stored: unknown) => BREAK_SETTINGS.schema.safeParse(stored);

  it('is the defaults when nothing is stored', () => {
    expect(parse({}).data).toEqual(DEFAULT_BREAK_SETTINGS);
  });

  it('fills fields left out with their defaults', () => {
    const settings = parse({ obs: { hideSources: ['Cam'] } }).data;

    expect(settings?.obs.hideSources).toEqual(['Cam']);
    expect(settings?.obs.muteInputs).toEqual(DEFAULT_BREAK_SETTINGS.obs.muteInputs);
    expect(settings?.messages).toEqual(DEFAULT_BREAK_SETTINGS.messages);
  });

  it('rejects an invalid field rather than defaulting it, naming each one', () => {
    const result = parse({
      obs: { muteInputs: 'Mic/Aux' },
      adWarnings: { pollIntervalSeconds: 5 },
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toEqual([
      'obs.muteInputs',
      'adWarnings.pollIntervalSeconds',
    ]);
  });

  it('rejects a key it does not know, such as a misspelt one', () => {
    expect(parse({ enabeld: false }).success).toBe(false);
  });

  it('replaces a message wholesale, dropping built-in per-platform overrides', () => {
    const settings = parse({ messages: { adBreakStarted: { default: 'BRB {duration}' } } }).data;

    expect(settings?.messages.adBreakStarted).toEqual({ default: 'BRB {duration}' });
  });

  it('rejects a message with no default', () => {
    expect(parse({ messages: { breakEnded: { twitch: 'back' } } }).success).toBe(false);
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
