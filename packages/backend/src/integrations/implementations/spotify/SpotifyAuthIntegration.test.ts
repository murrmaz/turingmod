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
    upsert = vi.fn().mockResolvedValue(undefined);
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

    expect(integration.getTokenData()).toMatchObject({
      accessToken: 'refreshed',
      refreshToken: 'refresh',
    });
  });
});
