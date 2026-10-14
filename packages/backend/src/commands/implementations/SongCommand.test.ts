import 'reflect-metadata';
import type { PlaybackState } from '@spotify/web-api-ts-sdk';
import { describe, expect, it, vi } from 'vitest';
import type { SpotifyApiIntegration } from '../../integrations/implementations/spotify/SpotifyApiIntegration.js';
import { Logger } from '../../utils/Logger.js';
import { describePlayback, SongCommand } from './SongCommand.js';

function playing(item: Record<string, unknown> | null, isPlaying = true): PlaybackState {
  return { is_playing: isPlaying, item } as unknown as PlaybackState;
}

const TRACK = {
  type: 'track',
  name: 'Strobe',
  artists: [{ name: 'deadmau5' }, { name: 'Guest' }],
  external_urls: { spotify: 'https://open.spotify.com/track/1' },
};

describe('describePlayback', () => {
  it('names a track and its artists, with a link', () => {
    expect(describePlayback(playing(TRACK))).toBe(
      'Now playing: Strobe by deadmau5, Guest — https://open.spotify.com/track/1'
    );
  });

  it('names a podcast episode and its show', () => {
    const episode = {
      type: 'episode',
      name: 'Episode 12',
      show: { name: 'The Show' },
      external_urls: { spotify: 'https://open.spotify.com/episode/2' },
    };
    expect(describePlayback(playing(episode))).toBe(
      'Now playing: Episode 12 from The Show — https://open.spotify.com/episode/2'
    );
  });

  it('says nothing is playing when Spotify has no playback, is paused, or is playing an ad', () => {
    const nothing = 'Nothing is playing on Spotify right now';
    expect(describePlayback(null)).toBe(nothing);
    expect(describePlayback(playing(TRACK, false))).toBe(nothing);
    expect(describePlayback(playing(null))).toBe(nothing);
  });
});

describe('SongCommand', () => {
  function command(request: SpotifyApiIntegration['request']) {
    return new SongCommand({ request } as SpotifyApiIntegration, new Logger({ level: 'silent' }));
  }

  it('asks Spotify for episodes as well as tracks', async () => {
    const getCurrentlyPlayingTrack = vi.fn(() => Promise.resolve(playing(TRACK)));
    const sdk = { player: { getCurrentlyPlayingTrack } };
    const song = command((call) => call(sdk as never));

    const result = await song.execute({} as never);

    expect(result.success).toBe(true);
    expect(getCurrentlyPlayingTrack).toHaveBeenCalledWith(undefined, 'episode');
  });

  it('reports a failure without leaking the error to chat', async () => {
    const song = command(() => Promise.reject(new Error('Spotify is not connected')));

    const result = await song.execute({} as never);

    expect(result).toMatchObject({
      success: false,
      message: "Couldn't check Spotify right now",
      error: { code: 'API_ERROR', message: 'Spotify is not connected' },
    });
  });
});
