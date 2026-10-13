import 'reflect-metadata';
import { IntegrationStatus } from '@turingmod/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../../core/EventBus.js';
import type { IntegrationStateRepository } from '../../../database/repositories/IntegrationStateRepository.js';
import type { TuringModConfig } from '../../../utils/Config.js';
import { Logger } from '../../../utils/Logger.js';
import { TWITCH_REQUIRED_SCOPES, TwitchAuthIntegration } from './TwitchAuthIntegration.js';

const CONFIG = {
  clientId: 'client-id',
  clientSecret: 'client-secret',
  grantedScopes: [...TWITCH_REQUIRED_SCOPES],
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

function makeIntegration(
  stateRepo: Pick<IntegrationStateRepository, 'upsert'>,
  eventBus: EventBus = new EventBus(new Logger({ level: 'silent' })),
  serverPort = 8080
) {
  return new TwitchAuthIntegration(
    eventBus,
    new Logger({ level: 'silent' }),
    stateRepo as IntegrationStateRepository,
    { serverPort } as TuringModConfig
  );
}

function successfulTokenExchange() {
  vi.mocked(fetch).mockImplementation((input) => {
    const url = input.toString();
    if (url.includes('/oauth2/token')) {
      return jsonResponse(200, {
        access_token: 'refreshed-access-token',
        refresh_token: 'refreshed-refresh-token',
        expires_in: 14400,
        scope: [...TWITCH_REQUIRED_SCOPES],
      });
    }
    if (url.includes('/oauth2/validate')) {
      return jsonResponse(200, {
        client_id: CONFIG.clientId,
        login: 'streamer',
        user_id: 'user-123',
        scopes: [...TWITCH_REQUIRED_SCOPES],
        expires_in: 14400,
      });
    }
    throw new Error(`Unexpected fetch call: ${url}`);
  });
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
    successfulTokenExchange();

    await integration.initialize(CONFIG);
    await integration.start();

    expect(integration.getStatus()).toBe(IntegrationStatus.CONNECTED);
    expect(upsert).toHaveBeenCalledWith(
      'twitch-auth',
      expect.objectContaining({ accessToken: 'refreshed-access-token' }),
      true
    );
  });

  it('stays connected, without an unhandled rejection, when a refreshed token cannot be saved', async () => {
    const upsert = vi.fn().mockRejectedValue(new Error('database is locked'));
    const integration = makeIntegration({ upsert });
    successfulTokenExchange();

    await integration.initialize(CONFIG);
    await integration.start();
    // Let the refresh listener's save settle; vitest fails the run on an unhandled rejection.
    await new Promise((resolve) => setImmediate(resolve));

    expect(upsert).toHaveBeenCalled();
    expect(integration.getStatus()).toBe(IntegrationStatus.CONNECTED);
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

  it('marks itself NEEDS_REAUTH when another integration reports the authorization was revoked', async () => {
    const eventBus = new EventBus(new Logger({ level: 'silent' }));
    const integration = makeIntegration({ upsert: vi.fn().mockResolvedValue(undefined) }, eventBus);
    successfulTokenExchange();

    await integration.initialize(CONFIG);
    await integration.start();
    expect(integration.getStatus()).toBe(IntegrationStatus.CONNECTED);

    // Simulates TwitchEventSubIntegration detecting a revoked subscription
    // and publishing the fact, independent of this integration's own
    // refresh-failure detection.
    await eventBus.emit('twitch.authorizationRevoked', { reason: 'authorization_revoked' });

    expect(integration.getStatus()).toBe(IntegrationStatus.NEEDS_REAUTH);
    expect(integration.getErrorMessage()).toMatch(/re-authorization required/i);
  });

  it('stops reacting to authorizationRevoked events after being stopped', async () => {
    const eventBus = new EventBus(new Logger({ level: 'silent' }));
    const integration = makeIntegration({ upsert: vi.fn().mockResolvedValue(undefined) }, eventBus);
    successfulTokenExchange();

    await integration.initialize(CONFIG);
    await integration.start();
    await integration.stop();

    expect(eventBus.listenerCount('twitch.authorizationRevoked')).toBe(0);

    await eventBus.emit('twitch.authorizationRevoked', { reason: 'authorization_revoked' });

    expect(integration.getStatus()).toBe(IntegrationStatus.DISCONNECTED);
  });

  it('does not accumulate listeners across repeated failed start() retries', async () => {
    const eventBus = new EventBus(new Logger({ level: 'silent' }));
    const integration = makeIntegration({ upsert: vi.fn().mockResolvedValue(undefined) }, eventBus);

    vi.mocked(fetch).mockImplementation((input) => {
      const url = input.toString();
      if (url.includes('/oauth2/token')) {
        return jsonResponse(400, { status: 400, message: 'Invalid refresh token' });
      }
      throw new Error(`Unexpected fetch call: ${url}`);
    });

    await integration.initialize(CONFIG);
    await expect(integration.start()).rejects.toThrow();
    await expect(integration.start()).rejects.toThrow();
    await expect(integration.start()).rejects.toThrow();

    expect(eventBus.listenerCount('twitch.authorizationRevoked')).toBe(1);
  });

  it('requires re-authorization, without contacting Twitch, when the stored grant predates a required scope', async () => {
    const eventBus = new EventBus(new Logger({ level: 'silent' }));
    const integration = makeIntegration({ upsert: vi.fn().mockResolvedValue(undefined) }, eventBus);

    await integration.initialize({ ...CONFIG, grantedScopes: ['chat:read'] });
    await integration.start();

    expect(integration.getStatus()).toBe(IntegrationStatus.NEEDS_REAUTH);
    expect(integration.getErrorMessage()).toMatch(/channel:read:ads/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('requests the current required scopes, not the previously granted ones, in the authorization URL', async () => {
    const integration = makeIntegration({ upsert: vi.fn().mockResolvedValue(undefined) });
    await integration.initialize({ ...CONFIG, grantedScopes: ['chat:read'] });

    const url = new URL(integration.getAuthorizationUrl('state-123'));

    expect(url.searchParams.get('scope')?.split(' ')).toEqual(TWITCH_REQUIRED_SCOPES);
  });

  it('derives its redirect URI from the server port, ignoring one saved in an older config', async () => {
    const upsert = vi.fn().mockResolvedValue(undefined);
    const integration = makeIntegration({ upsert }, undefined, 9123);
    const staleConfig = { ...CONFIG, redirectUri: 'http://localhost:8080/callback/twitch' };
    successfulTokenExchange();

    expect(integration.getRedirectUri()).toBe('http://localhost:9123/callback/twitch');

    await integration.initialize(staleConfig);
    const url = new URL(integration.getAuthorizationUrl('state-123'));
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:9123/callback/twitch');

    await integration.exchangeCode('code-123');
    const [, init] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(new URLSearchParams(String(init?.body)).get('redirect_uri')).toBe(
      'http://localhost:9123/callback/twitch'
    );
  });

  it('builds the authorization URL from the stored credentials that will exchange the code', async () => {
    const integration = makeIntegration({ upsert: vi.fn().mockResolvedValue(undefined) });

    expect(integration.isConfigured()).toBe(false);
    expect(() => integration.getAuthorizationUrl('state-123')).toThrow(/not configured/);

    await integration.initialize({ clientId: 'client-id', clientSecret: 'client-secret' });

    expect(integration.isConfigured()).toBe(true);
    const url = new URL(integration.getAuthorizationUrl('state-123'));
    expect(url.searchParams.get('client_id')).toBe('client-id');
  });
});
