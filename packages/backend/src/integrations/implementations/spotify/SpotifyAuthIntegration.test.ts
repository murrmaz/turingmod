import 'reflect-metadata';
import { IntegrationStatus } from '@turingmod/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IntegrationStateRepository } from '../../../database/repositories/IntegrationStateRepository.js';
import type { TuringModConfig } from '../../../utils/Config.js';
import { Logger } from '../../../utils/Logger.js';
import { SpotifyAuthIntegration } from './SpotifyAuthIntegration.js';

const SCOPES =
  'user-read-currently-playing user-read-playback-state user-modify-playback-state user-read-recently-played';

function tokenResponse(body: Record<string, unknown>): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify({ token_type: 'Bearer', expires_in: 3600, ...body }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  );
}

describe('SpotifyAuthIntegration', () => {
  let upsert: ReturnType<typeof vi.fn>;
  let integration: SpotifyAuthIntegration;

  beforeEach(async () => {
    vi.stubGlobal('fetch', vi.fn());
    upsert = vi.fn();
    integration = new SpotifyAuthIntegration(
      new Logger({ level: 'silent' }),
      { upsert } as unknown as IntegrationStateRepository,
      { serverPort: 8080 } as TuringModConfig
    );
    await integration.initialize({ clientId: 'id', clientSecret: 'secret' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('records the granted scopes from the code exchange, so the grant passes the start check', async () => {
    vi.mocked(fetch).mockReturnValue(
      tokenResponse({ access_token: 'access', refresh_token: 'refresh', scope: SCOPES })
    );

    await integration.exchangeCode('code');
    await integration.start();

    expect(upsert).toHaveBeenCalledWith(
      'spotify-auth',
      expect.objectContaining({ grantedScopes: SCOPES.split(' ') }),
      true
    );
    expect(integration.getStatus()).toBe(IntegrationStatus.CONNECTED);
  });

  it('keeps the stored refresh token when a refresh does not return a new one', async () => {
    vi.mocked(fetch)
      .mockReturnValueOnce(
        tokenResponse({ access_token: 'access', refresh_token: 'refresh', scope: SCOPES })
      )
      .mockReturnValueOnce(tokenResponse({ access_token: 'refreshed', scope: SCOPES }));

    await integration.exchangeCode('code');
    await integration.refreshAccessToken();

    expect(upsert).toHaveBeenLastCalledWith(
      'spotify-auth',
      expect.objectContaining({ accessToken: 'refreshed', refreshToken: 'refresh' }),
      true
    );
  });

  describe('getAccessToken', () => {
    async function connect(expiresIn = 3600) {
      vi.mocked(fetch).mockReturnValueOnce(
        tokenResponse({
          access_token: 'access',
          refresh_token: 'refresh',
          scope: SCOPES,
          expires_in: expiresIn,
        })
      );
      await integration.exchangeCode('code');
      await integration.start();
    }

    it('returns the stored token while it has time left', async () => {
      await connect();

      expect(await integration.getAccessToken()).toBe('access');
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('refreshes, with the client secret, a token about to expire', async () => {
      await connect(30);
      vi.mocked(fetch).mockReturnValueOnce(tokenResponse({ access_token: 'fresh', scope: SCOPES }));

      expect(await integration.getAccessToken()).toBe('fresh');
      const [, init] = vi.mocked(fetch).mock.calls[1] ?? [];
      expect(new Headers(init?.headers).get('Authorization')).toBe(
        `Basic ${Buffer.from('id:secret').toString('base64')}`
      );
    });

    it('shares one refresh between concurrent callers', async () => {
      await connect(30);
      vi.mocked(fetch).mockReturnValueOnce(tokenResponse({ access_token: 'fresh', scope: SCOPES }));

      const tokens = await Promise.all([
        integration.getAccessToken(),
        integration.getAccessToken(),
        integration.refreshAccessToken(),
      ]);

      expect(tokens).toEqual(['fresh', 'fresh', 'fresh']);
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('needs re-authorization when Spotify rejects the refresh token', async () => {
      await connect(30);
      vi.mocked(fetch).mockResolvedValueOnce(new Response('invalid_grant', { status: 400 }));

      await expect(integration.getAccessToken()).rejects.toThrow('Token refresh failed');
      expect(integration.getStatus()).toBe(IntegrationStatus.NEEDS_REAUTH);
    });

    it('stays connected when Spotify fails a refresh on its side', async () => {
      await connect(30);
      vi.mocked(fetch).mockResolvedValueOnce(new Response('oops', { status: 503 }));

      await expect(integration.getAccessToken()).rejects.toThrow('Token refresh failed');
      expect(integration.getStatus()).toBe(IntegrationStatus.CONNECTED);
    });

    it('refuses while Spotify is not connected', async () => {
      await expect(integration.getAccessToken()).rejects.toThrow('Spotify is not connected');
    });
  });
});
