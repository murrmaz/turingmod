import 'reflect-metadata';
import { IntegrationStatus } from '@turingmod/shared';
import { google } from 'googleapis';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IntegrationStateRepository } from '../../../database/repositories/IntegrationStateRepository.js';
import type { TuringModConfig } from '../../../utils/Config.js';
import { Logger } from '../../../utils/Logger.js';
import { YouTubeAuthIntegration } from './YouTubeAuthIntegration.js';

const SCOPES = [
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/youtube.force-ssl',
];
const CREDENTIALS = { clientId: 'id', clientSecret: 'secret' };
const GRANT = {
  ...CREDENTIALS,
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  expiryDate: 1_000,
  grantedScopes: SCOPES,
};

function setup() {
  const saveConfig = vi.fn();
  const integration = new YouTubeAuthIntegration(
    new Logger({ level: 'silent' }),
    { saveConfig } as unknown as IntegrationStateRepository,
    { serverPort: 8080 } as TuringModConfig
  );
  return { integration, saveConfig };
}

async function connected() {
  const { integration, saveConfig } = setup();
  await integration.initialize(GRANT);
  await integration.start();
  const client = integration.getAuthClient();
  if (!client) {
    throw new Error('no client after start()');
  }
  return { integration, saveConfig, client };
}

describe('YouTubeAuthIntegration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('connecting', () => {
    it("waits for the streamer without a refresh token, since it can't refresh without one", async () => {
      const { integration } = setup();
      await integration.initialize({ ...CREDENTIALS, accessToken: 'a', grantedScopes: SCOPES });

      await integration.start();

      expect(integration.getStatus()).toBe(IntegrationStatus.DISCONNECTED);
      expect(integration.getAuthClient()).toBeNull();
    });

    it('builds a client holding the stored tokens', async () => {
      const { integration, client } = await connected();

      expect(integration.getStatus()).toBe(IntegrationStatus.CONNECTED);
      expect(client.credentials).toEqual({
        access_token: 'access-1',
        refresh_token: 'refresh-1',
        expiry_date: 1_000,
      });
    });

    it('hands out one client, which is how the API layer knows it is still current', async () => {
      const { integration, client } = await connected();

      expect(integration.getAuthClient()).toBe(client);
    });

    it('drops the client when stopped', async () => {
      const { integration } = await connected();

      await integration.stop();

      expect(integration.getAuthClient()).toBeNull();
    });

    it('keeps the client when the grant dies, for the API layer to refuse', async () => {
      const { integration, client } = await connected();

      integration.markAuthRequired();

      expect(integration.getStatus()).toBe(IntegrationStatus.NEEDS_REAUTH);
      expect(integration.getAuthClient()).toBe(client);
    });
  });

  describe('a token refresh', () => {
    it('stores the new token, keeping the refresh token Google leaves out', async () => {
      const { client, saveConfig } = await connected();

      client.emit('tokens', { access_token: 'access-2', expiry_date: 2_000 });

      expect(saveConfig).toHaveBeenCalledWith(
        'youtube-auth',
        expect.objectContaining({
          accessToken: 'access-2',
          refreshToken: 'refresh-1',
          expiryDate: 2_000,
        })
      );
      expect(client.credentials).toEqual({
        access_token: 'access-2',
        refresh_token: 'refresh-1',
        expiry_date: 2_000,
      });
    });

    it('takes a new refresh token when Google does send one', async () => {
      const { client, saveConfig } = await connected();

      client.emit('tokens', { refresh_token: 'refresh-2' });

      expect(saveConfig).toHaveBeenCalledWith(
        'youtube-auth',
        expect.objectContaining({ refreshToken: 'refresh-2', accessToken: 'access-1' })
      );
    });

    it('says so, without changing status', async () => {
      const { integration, client } = await connected();
      const refreshed = vi.fn();
      integration.on('tokenRefreshed', refreshed);

      client.emit('tokens', { access_token: 'access-2', expiry_date: 2_000 });

      expect(refreshed).toHaveBeenCalledWith({ expiresAt: 2_000 });
      expect(integration.getStatus()).toBe(IntegrationStatus.CONNECTED);
    });

    it('stays connected when the new token cannot be stored', async () => {
      const { integration, client, saveConfig } = await connected();
      saveConfig.mockImplementation(() => {
        throw new Error('disk full');
      });

      client.emit('tokens', { access_token: 'access-2' });

      expect(integration.getStatus()).toBe(IntegrationStatus.CONNECTED);
      expect(client.credentials.access_token).toBe('access-2');
    });
  });

  describe('authorizing', () => {
    it('asks for a refresh token and every scope, on the 127.0.0.1 redirect', async () => {
      const { integration } = setup();
      await integration.initialize(CREDENTIALS);

      const url = new URL(integration.getAuthorizationUrl('state-1'));

      expect(url.searchParams.get('access_type')).toBe('offline');
      expect(url.searchParams.get('prompt')).toBe('consent');
      expect(url.searchParams.get('state')).toBe('state-1');
      expect(url.searchParams.get('scope')?.split(' ')).toEqual(SCOPES);
      expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:8080/callback/youtube');
    });

    it('stores what the code is exchanged for, with what was granted', async () => {
      const { integration, saveConfig } = setup();
      await integration.initialize(CREDENTIALS);
      vi.spyOn(google.auth.OAuth2.prototype, 'getToken').mockImplementation((() =>
        Promise.resolve({
          tokens: {
            access_token: 'access-1',
            refresh_token: 'refresh-1',
            expiry_date: 1_000,
            scope: SCOPES.join(' '),
          },
        })) as never);

      await integration.exchangeCode('code');

      expect(saveConfig).toHaveBeenCalledWith('youtube-auth', { ...CREDENTIALS, ...GRANT });
    });
  });

  describe('a refresh finishing after the client has moved on', () => {
    it('keeps a new authorization from being overwritten by the grant it replaced', async () => {
      const { client, integration, saveConfig } = await connected();
      vi.spyOn(google.auth.OAuth2.prototype, 'getToken').mockImplementation((() =>
        Promise.resolve({
          tokens: { access_token: 'new-grant', refresh_token: 'new-refresh', scope: SCOPES[0] },
        })) as never);
      await integration.exchangeCode('code');
      saveConfig.mockClear();

      client.emit('tokens', { access_token: 'old-grant-refreshed', refresh_token: 'old-refresh' });

      expect(saveConfig).not.toHaveBeenCalled();
      expect(client.credentials.access_token).toBe('access-1');
    });

    it('still saves after a plain stop, since Google may have rotated the refresh token', async () => {
      const { client, integration, saveConfig } = await connected();

      await integration.stop();
      client.emit('tokens', { refresh_token: 'rotated' });

      expect(saveConfig).toHaveBeenCalledWith(
        'youtube-auth',
        expect.objectContaining({ refreshToken: 'rotated' })
      );
    });
  });

  describe('recognizing a dead grant', () => {
    const { integration } = setup();

    it.each([
      ['a 401', Object.assign(new Error('Unauthorized'), { status: 401 })],
      ['invalid_grant', new Error('invalid_grant')],
    ])('counts %s', (_name, error) => {
      expect(integration.isAuthError(error)).toBe(true);
    });

    it.each([
      ['a quota error', Object.assign(new Error('quotaExceeded'), { status: 403 })],
      ['an outage', Object.assign(new Error('Backend Error'), { status: 503 })],
      ['anything else', new Error('socket hang up')],
    ])('does not count %s', (_name, error) => {
      expect(integration.isAuthError(error)).toBe(false);
    });
  });
});
