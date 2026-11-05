import { StreamingPlatform } from '@turingmod/shared';
import { describe, expect, it } from 'vitest';
import { fail, mirrorReply, ok } from './results.js';

describe('command results', () => {
  it('builds a success and a failure', () => {
    expect(ok('Done')).toEqual({ success: true, message: 'Done' });
    expect(fail('INVALID_INPUT', 'Usage: !roll 2d6', 'Not a dice roll')).toEqual({
      success: false,
      message: 'Usage: !roll 2d6',
      error: { code: 'INVALID_INPUT', reason: 'Not a dice roll' },
    });
  });

  it('describes a mirrored write with the platforms that took it', () => {
    const result = mirrorReply(
      {
        updated: [StreamingPlatform.TWITCH],
        skipped: [],
        failures: [{ platform: StreamingPlatform.YOUTUBE, error: 'No active broadcast' }],
      },
      'title',
      (platforms) => `Title updated on ${platforms}`
    );

    expect(result).toEqual({ success: true, message: 'Title updated on Twitch' });
  });

  it('fails a mirrored write no platform took, keeping the platform error out of chat', () => {
    const result = mirrorReply(
      {
        updated: [],
        skipped: [],
        failures: [{ platform: StreamingPlatform.TWITCH, error: 'Helix rejected the update' }],
      },
      'title',
      () => 'unused'
    );

    expect(result).toEqual(
      fail('API_ERROR', 'Failed to update title on Twitch', 'Twitch: Helix rejected the update')
    );
  });

  it('names every platform that failed, not just the first', () => {
    const result = mirrorReply(
      {
        updated: [],
        skipped: [],
        failures: [
          { platform: StreamingPlatform.TWITCH, error: 'Helix rejected the update' },
          { platform: StreamingPlatform.YOUTUBE, error: 'quota' },
        ],
      },
      'title',
      () => 'unused'
    );

    expect(result).toEqual(
      fail(
        'API_ERROR',
        'Failed to update title on Twitch, YouTube',
        'Twitch: Helix rejected the update; YouTube: quota'
      )
    );
  });

  it('repeats in chat a failure about the value asked for', () => {
    const result = mirrorReply(
      {
        updated: [],
        skipped: [],
        failures: [
          { platform: StreamingPlatform.TWITCH, error: 'Game not found: Nope', invalidValue: true },
        ],
      },
      'game',
      () => 'unused'
    );

    expect(result).toEqual(
      fail('INVALID_INPUT', 'Game not found: Nope', 'Twitch: Game not found: Nope')
    );
  });

  it('repeats a failure about the value asked for even when it is not the first', () => {
    const result = mirrorReply(
      {
        updated: [],
        skipped: [],
        failures: [
          { platform: StreamingPlatform.TWITCH, error: 'Helix rejected the update' },
          { platform: StreamingPlatform.YOUTUBE, error: 'Title too long', invalidValue: true },
        ],
      },
      'title',
      () => 'unused'
    );

    expect(result).toEqual(
      fail(
        'INVALID_INPUT',
        'Title too long',
        'Twitch: Helix rejected the update; YouTube: Title too long'
      )
    );
  });

  it('fails a mirrored write when no platform is live', () => {
    const result = mirrorReply({ updated: [], skipped: [], failures: [] }, 'tags', () => 'unused');

    expect(result).toMatchObject({ error: { reason: 'No live platforms to update' } });
  });

  it('names a platform that could not be tried to the streamer, and keeps it out of chat', () => {
    const result = mirrorReply(
      {
        updated: [],
        failures: [],
        skipped: [{ platform: StreamingPlatform.TWITCH, reason: 'Re-authorization needed' }],
      },
      'title',
      () => 'unused'
    );

    expect(result).toEqual(
      fail('API_ERROR', 'Failed to update title', 'Twitch: Re-authorization needed')
    );
  });

  it('names in chat the platform that answered, and gives the streamer both', () => {
    const result = mirrorReply(
      {
        updated: [],
        failures: [{ platform: StreamingPlatform.YOUTUBE, error: 'quota' }],
        skipped: [{ platform: StreamingPlatform.TWITCH, reason: 'Re-authorization needed' }],
      },
      'title',
      () => 'unused'
    );

    expect(result).toEqual(
      fail(
        'API_ERROR',
        'Failed to update title on YouTube',
        'YouTube: quota; Twitch: Re-authorization needed'
      )
    );
  });

  it('succeeds when another platform took the write', () => {
    const result = mirrorReply(
      {
        updated: [StreamingPlatform.YOUTUBE],
        failures: [],
        skipped: [{ platform: StreamingPlatform.TWITCH, reason: 'Re-authorization needed' }],
      },
      'title',
      (platforms) => `Updated on ${platforms}`
    );

    expect(result).toEqual(ok('Updated on YouTube'));
  });
});
