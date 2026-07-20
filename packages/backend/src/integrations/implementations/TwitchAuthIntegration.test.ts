import { IntegrationStatus } from '@turingmod/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../core/EventBus.js';
import type { IntegrationStateRepository } from '../../database/repositories/IntegrationStateRepository.js';
import { Logger } from '../../utils/Logger.js';
import { TwitchAuthIntegration } from './TwitchAuthIntegration.js';

const CONFIG = {
  clientId: 'client-id',
  clientSecret: 'client-secret',
  redirectUri: 'http://localhost:8080/callback/twitch',
  scopes: ['chat:read'],
  accessToken: 'stale-access-token',
  refreshToken: 'refresh-token',
  expiresIn: 3600,
  // Obtained far enough in the past that the token is already expired,
  // forcing Twurple's addUserForToken() to refresh it immediately.
  obtainmentTimestamp: Date.now() - 24 * 60 * 60 * 1000,
};

function jsonResponse(status: number, body: unknown): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  );
}

function makeIntegration(stateRepo: Pick<IntegrationStateRepository, 'upsert'>) {
  return new TwitchAuthIntegration(
    new EventBus(),
    new Logger({ level: 'silent' }),
    stateRepo as IntegrationStateRepository
  );
}

describe('TwitchAuthIntegration', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    global.fetch = originalFetch;
  });

  it('persists a token refreshed during addUserForToken (not just refreshes triggered later)', async () => {
    const upsert = vi.fn().mockResolvedValue(undefined);
    const integration = makeIntegration({ upsert });

    vi.mocked(fetch).mockImplementation((input) => {
      const url = input.toString();
      if (url.includes('/oauth2/token')) {
        return jsonResponse(200, {
          access_token: 'refreshed-access-token',
          refresh_token: 'refreshed-refresh-token',
          expires_in: 14400,
          scope: ['chat:read'],
        });
      }
      if (url.includes('/oauth2/validate')) {
        return jsonResponse(200, {
          client_id: CONFIG.clientId,
          login: 'streamer',
          user_id: 'user-123',
          scopes: ['chat:read'],
          expires_in: 14400,
        });
      }
      throw new Error(`Unexpected fetch call: ${url}`);
    });

    await integration.initialize(CONFIG);
    await integration.start();

    expect(integration.getStatus()).toBe(IntegrationStatus.CONNECTED);
    expect(upsert).toHaveBeenCalledWith(
      'twitch-auth',
      expect.objectContaining({ accessToken: 'refreshed-access-token' }),
      true
    );
  });

  it('marks the integration NEEDS_REAUTH (not a generic ERROR) when the refresh token is dead', async () => {
    const upsert = vi.fn().mockResolvedValue(undefined);
    const integration = makeIntegration({ upsert });

    vi.mocked(fetch).mockImplementation((input) => {
      const url = input.toString();
      if (url.includes('/oauth2/token')) {
        return jsonResponse(400, { status: 400, message: 'Invalid refresh token' });
      }
      throw new Error(`Unexpected fetch call: ${url}`);
    });

    await integration.initialize(CONFIG);

    await expect(integration.start()).rejects.toThrow();

    expect(integration.getStatus()).toBe(IntegrationStatus.NEEDS_REAUTH);
    expect(integration.getErrorMessage()).toMatch(/re-authorization required/i);
  });
});
