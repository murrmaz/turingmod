import 'reflect-metadata';
import { IntegrationStatus } from '@turingmod/shared';
import { HttpStatusCodeError } from '@twurple/api-call';
import { CachedRefreshFailureError } from '@twurple/auth';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../../core/EventBus.js';
import type { IntegrationStateRepository } from '../../../database/repositories/IntegrationStateRepository.js';
import type { TuringModConfig } from '../../../utils/Config.js';
import { Logger } from '../../../utils/Logger.js';
import { IntegrationManager } from '../../IntegrationManager.js';
import { TwitchApiIntegration } from './TwitchApiIntegration.js';
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

/** The same grant on a token that hasn't expired, so starting doesn't refresh it. */
const FRESH_CONFIG = { ...CONFIG, obtainmentTimestamp: Date.now() };

function jsonResponse(status: number, body: unknown): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  );
}

function makeIntegration(
  stateRepo: Pick<IntegrationStateRepository, 'saveConfig'>,
  serverPort = 8080
) {
  return new TwitchAuthIntegration(
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
    const saveConfig = vi.fn();
    const integration = makeIntegration({ saveConfig });
    successfulTokenExchange();

    await integration.initialize(CONFIG);
    await integration.start();

    expect(integration.getStatus()).toBe(IntegrationStatus.CONNECTED);
    expect(saveConfig).toHaveBeenCalledWith(
      'twitch-auth',
      expect.objectContaining({ accessToken: 'refreshed-access-token' })
    );
  });

  it('stays connected when a refreshed token cannot be saved', async () => {
    const saveConfig = vi.fn(() => {
      throw new Error('database is locked');
    });
    const integration = makeIntegration({ saveConfig });
    successfulTokenExchange();

    await integration.initialize(CONFIG);
    await integration.start();

    expect(saveConfig).toHaveBeenCalled();
    expect(integration.getStatus()).toBe(IntegrationStatus.CONNECTED);
  });

  it('marks the integration NEEDS_REAUTH (not a generic ERROR) when the refresh token is dead', async () => {
    const saveConfig = vi.fn();
    const integration = makeIntegration({ saveConfig });

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

  describe('a token refresh failing while connected', () => {
    /** Started on a token that hasn't expired, with Twitch's token endpoint under the test's control. */
    async function connected() {
      const saveConfig = vi.fn();
      const integration = makeIntegration({ saveConfig });
      successfulTokenExchange();
      await integration.initialize(FRESH_CONFIG);
      await integration.start();
      const provider = integration.getAuthProvider();
      if (!provider) {
        throw new Error('provider unexpectedly null after start()');
      }
      return { integration, provider, saveConfig };
    }

    const tokenEndpointAnswers = (answer: () => Promise<Response>) => {
      const validate = vi.mocked(fetch).getMockImplementation();
      vi.mocked(fetch).mockImplementation((input, init) =>
        input.toString().includes('/oauth2/token')
          ? answer()
          : (validate as typeof fetch)(input, init)
      );
    };

    const transientFailures: [string, () => Promise<Response>][] = [
      ['the network being down', () => Promise.reject(new TypeError('fetch failed'))],
      ['a 503', () => jsonResponse(503, { status: 503, message: 'Service Unavailable' })],
      ['a rate limit', () => jsonResponse(429, { status: 429, message: 'Too Many Requests' })],
    ];

    it.each(transientFailures)('stays connected through %s, and recovers', async (_, failure) => {
      const { integration, provider, saveConfig } = await connected();

      tokenEndpointAnswers(failure);
      await expect(provider.refreshAccessTokenForUser('user-123')).rejects.toThrow();
      expect(integration.getStatus()).toBe(IntegrationStatus.CONNECTED);

      // The same provider, so nothing holding it has to be rebuilt.
      successfulTokenExchange();
      const token = await provider.refreshAccessTokenForUser('user-123');

      expect(token.accessToken).toBe('refreshed-access-token');
      expect(integration.getAuthProvider()).toBe(provider);
      expect(saveConfig).toHaveBeenCalledWith(
        'twitch-auth',
        expect.objectContaining({ accessToken: 'refreshed-access-token' })
      );
    });

    it.each([400, 403])('requires re-authorization when Twitch refuses it (%i)', async (status) => {
      const { integration, provider } = await connected();

      tokenEndpointAnswers(() => jsonResponse(status, { status, message: 'refused' }));
      await expect(provider.refreshAccessTokenForUser('user-123')).rejects.toThrow();

      expect(integration.getStatus()).toBe(IntegrationStatus.NEEDS_REAUTH);
      await expect(provider.getAccessTokenForUser('user-123')).rejects.toThrow(
        CachedRefreshFailureError
      );
    });

    it('stays stopped when a refresh still in flight at stop() fails', async () => {
      const { integration, provider } = await connected();
      await integration.stop();

      tokenEndpointAnswers(() => jsonResponse(400, { status: 400, message: 'refused' }));
      await expect(provider.refreshAccessTokenForUser('user-123')).rejects.toThrow();

      expect(integration.getStatus()).toBe(IntegrationStatus.DISCONNECTED);
    });
  });

  describe('credentials in a failed token request', () => {
    /** An integration run by a real manager, with everything it logs and publishes collected. */
    function managed() {
      const written: string[] = [];
      const logger = new Logger({
        level: 'trace',
        destination: { write: (line: string) => written.push(line) },
      });
      const eventBus = new EventBus(new Logger({ level: 'silent' }));
      const stateRepo = { saveConfig: vi.fn() } as unknown as IntegrationStateRepository;
      const integration = new TwitchAuthIntegration(logger, stateRepo, {
        serverPort: 8080,
      } as TuringModConfig);
      const manager = new IntegrationManager(stateRepo, eventBus, logger);
      manager.register(integration);
      const published: string[] = [];
      eventBus.on('integration.error', ({ error }) => {
        published.push(`${error.message} ${error.stack}`);
      });
      return { integration, manager, written, published };
    }

    const expectNoCredentials = (text: string) => {
      expect(text).not.toContain(CONFIG.clientSecret);
      expect(text).not.toContain(CONFIG.refreshToken);
    };

    it('keeps them out of the status and the log when starting', async () => {
      const { integration, manager, written } = managed();
      vi.mocked(fetch).mockImplementation(() =>
        jsonResponse(503, { status: 503, message: 'Service Unavailable' })
      );

      await integration.initialize(CONFIG);
      const error: Error = await manager.startIntegration(integration.name).then(
        () => expect.unreachable('starting should fail'),
        (rejected) => rejected
      );

      expect(integration.getStatus()).toBe(IntegrationStatus.ERROR);
      // Checked, so the assertions below can't pass on a failure that never named them.
      expect(integration.getErrorMessage()).toContain('client_secret=<redacted>');
      expect(written.join('')).toContain('Failed to start integration: twitch-auth');
      expect(written.join('')).toContain('client_secret=<redacted>');
      expectNoCredentials(`${integration.getErrorMessage()} ${error.message} ${error.stack}`);
      expectNoCredentials(written.join(''));
    });

    it('keeps them out of the error thrown, the log and the activity log when connected', async () => {
      const { integration, written, published } = managed();
      successfulTokenExchange();
      await integration.initialize(FRESH_CONFIG);
      await integration.start();

      vi.mocked(fetch).mockImplementation(() =>
        jsonResponse(503, { status: 503, message: 'Service Unavailable' })
      );
      const error: HttpStatusCodeError = await integration
        .getAuthProvider()
        ?.refreshAccessTokenForUser('user-123')
        .then(
          () => expect.unreachable('refreshing should fail'),
          (rejected) => rejected
        );

      expect(error.statusCode).toBe(503);
      expect(error.message).toContain('client_secret=<redacted>');
      expect(published).toHaveLength(1);
      expect(written.join('')).toContain('Could not refresh the Twitch token');
      expectNoCredentials(`${error.message} ${error.stack} ${error.url}`);
      expectNoCredentials(published.join(''));
      expectNoCredentials(written.join(''));
    });
  });

  it('needs re-authorization when its API layer finds the grant dead, and stops the calls', async () => {
    const integration = makeIntegration({ saveConfig: vi.fn() });
    const api = new TwitchApiIntegration(new Logger({ level: 'silent' }), integration);
    successfulTokenExchange();
    await integration.initialize(CONFIG);
    await integration.start();
    await api.start();
    const unauthorized = new HttpStatusCodeError(401, 'Unauthorized', 'https://x', 'GET', '', true);

    await expect(api.request(() => Promise.reject(unauthorized))).rejects.toBe(unauthorized);

    expect(integration.getStatus()).toBe(IntegrationStatus.NEEDS_REAUTH);
    expect(integration.getErrorMessage()).toMatch(/rejected an API call/);
    const call = vi.fn();
    await expect(api.request(call)).rejects.toThrow('Twitch is not connected');
    expect(call).not.toHaveBeenCalled();
  });

  it('requires re-authorization, without contacting Twitch, when the stored grant predates a required scope', async () => {
    const integration = makeIntegration({ saveConfig: vi.fn() });

    await integration.initialize({ ...CONFIG, grantedScopes: ['chat:read'] });
    await integration.start();

    expect(integration.getStatus()).toBe(IntegrationStatus.NEEDS_REAUTH);
    expect(integration.getErrorMessage()).toMatch(/channel:read:ads/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('requests the current required scopes, not the previously granted ones, in the authorization URL', async () => {
    const integration = makeIntegration({ saveConfig: vi.fn() });
    await integration.initialize({ ...CONFIG, grantedScopes: ['chat:read'] });

    const url = new URL(integration.getAuthorizationUrl('state-123'));

    expect(url.searchParams.get('scope')?.split(' ')).toEqual(TWITCH_REQUIRED_SCOPES);
  });

  it('derives its redirect URI from the server port', async () => {
    const saveConfig = vi.fn();
    const integration = makeIntegration({ saveConfig }, 9123);
    successfulTokenExchange();

    expect(integration.getRedirectUri()).toBe('http://localhost:9123/callback/twitch');

    await integration.initialize(CONFIG);
    const url = new URL(integration.getAuthorizationUrl('state-123'));
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:9123/callback/twitch');

    await integration.exchangeCode('code-123');
    const [, init] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(new URLSearchParams(String(init?.body)).get('redirect_uri')).toBe(
      'http://localhost:9123/callback/twitch'
    );
  });

  it('builds the authorization URL from the stored credentials that will exchange the code', async () => {
    const integration = makeIntegration({ saveConfig: vi.fn() });

    expect(integration.isConfigured()).toBe(false);
    expect(() => integration.getAuthorizationUrl('state-123')).toThrow(/not configured/);

    await integration.initialize({ clientId: 'client-id', clientSecret: 'client-secret' });

    expect(integration.isConfigured()).toBe(true);
    const url = new URL(integration.getAuthorizationUrl('state-123'));
    expect(url.searchParams.get('client_id')).toBe('client-id');
  });

  describe('a refresh finishing after the provider has moved on', () => {
    /** Connected on an unexpired token, with Twitch answering token requests with `accessToken`. */
    async function connected() {
      const saveConfig = vi.fn();
      const integration = makeIntegration({ saveConfig });
      const token = { accessToken: 'unused' };
      vi.mocked(fetch).mockImplementation((input) => {
        const url = input.toString();
        if (url.includes('/oauth2/token')) {
          return jsonResponse(200, {
            access_token: token.accessToken,
            refresh_token: `${token.accessToken}-refresh`,
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
      await integration.initialize(FRESH_CONFIG);
      await integration.start();
      const provider = integration.getAuthProvider();
      if (!provider) {
        throw new Error('no provider after start()');
      }
      return { integration, provider, saveConfig, token };
    }

    it('keeps a new authorization from being overwritten by the grant it replaced', async () => {
      const { integration, provider, saveConfig, token } = await connected();

      token.accessToken = 'new-grant';
      await integration.exchangeCode('code');
      token.accessToken = 'old-grant-refreshed';
      await provider.refreshAccessTokenForUser('user-123');

      expect(saveConfig).toHaveBeenCalledOnce();
      expect(saveConfig).toHaveBeenCalledWith(
        'twitch-auth',
        expect.objectContaining({ accessToken: 'new-grant', refreshToken: 'new-grant-refresh' })
      );
    });

    it('still saves after a plain stop, since Twitch may have rotated the refresh token', async () => {
      const { integration, provider, saveConfig, token } = await connected();

      await integration.stop();
      token.accessToken = 'rotated';
      await provider.refreshAccessTokenForUser('user-123');

      expect(saveConfig).toHaveBeenCalledWith(
        'twitch-auth',
        expect.objectContaining({ refreshToken: 'rotated-refresh' })
      );
    });

    it('still saves when the refresh is for the grant it holds', async () => {
      const { provider, saveConfig, token } = await connected();

      token.accessToken = 'refreshed';
      await provider.refreshAccessTokenForUser('user-123');

      expect(saveConfig).toHaveBeenCalledWith(
        'twitch-auth',
        expect.objectContaining({ accessToken: 'refreshed' })
      );
    });
  });
});
