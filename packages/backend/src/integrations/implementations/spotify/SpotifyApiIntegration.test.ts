import 'reflect-metadata';
import { IntegrationStatus } from '@turingmod/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '../../../utils/Logger.js';
import { SpotifyApiIntegration, SpotifyHttpError } from './SpotifyApiIntegration.js';
import type { SpotifyAuthIntegration } from './SpotifyAuthIntegration.js';

function setup(status = IntegrationStatus.CONNECTED) {
  let token = 'token-1';
  const auth = {
    getStatus: () => status,
    getAccessToken: vi.fn(() => Promise.resolve(token)),
    refreshAccessToken: vi.fn(() => {
      token = 'token-2';
      return Promise.resolve(token);
    }),
  };
  const api = new SpotifyApiIntegration(
    new Logger({ level: 'silent' }),
    auth as unknown as SpotifyAuthIntegration
  );
  return { api, auth };
}

/** The bearer token each Spotify request was sent with. */
function bearerTokens(): (string | null)[] {
  return vi
    .mocked(fetch)
    .mock.calls.map(([, init]) => new Headers(init?.headers).get('Authorization'));
}

describe('SpotifyApiIntegration', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the token the auth integration hands out', async () => {
    const { api } = setup();
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 204 }));

    expect(await api.request((sdk) => sdk.player.getCurrentlyPlayingTrack())).toBeNull();
    expect(bearerTokens()).toEqual(['Bearer token-1']);
  });

  it('refreshes once and retries when Spotify rejects the token', async () => {
    const { api, auth } = setup();
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response('expired', { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await api.request((sdk) => sdk.player.getCurrentlyPlayingTrack());

    expect(auth.refreshAccessToken).toHaveBeenCalledOnce();
    expect(bearerTokens()).toEqual(['Bearer token-1', 'Bearer token-2']);
  });

  it('does not retry other failures', async () => {
    const { api, auth } = setup();
    vi.mocked(fetch).mockResolvedValue(new Response('slow down', { status: 429 }));

    const failure = api.request((sdk) => sdk.player.getCurrentlyPlayingTrack());

    await expect(failure).rejects.toBeInstanceOf(SpotifyHttpError);
    await expect(failure).rejects.toMatchObject({ status: 429 });
    expect(auth.refreshAccessToken).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('refuses to call Spotify while auth is not connected', async () => {
    const { api } = setup(IntegrationStatus.NEEDS_REAUTH);

    await expect(api.request((sdk) => sdk.player.getCurrentlyPlayingTrack())).rejects.toThrow(
      'Spotify is not connected'
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});
