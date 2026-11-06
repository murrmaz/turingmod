import { IntegrationName } from '@turingmod/shared';
import 'reflect-metadata';
import { IntegrationStatus } from '@turingmod/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { IntegrationStateRepository } from '../database/repositories/IntegrationStateRepository.js';
import { fake } from '../testing.js';
import type { TuringModConfig } from '../utils/Config.js';
import { Logger } from '../utils/Logger.js';
import {
  type ClientAuthentication,
  type StandardOAuthConfig,
  StandardOAuthConfigSchema,
  StandardOAuthIntegration,
} from './StandardOAuthIntegration.js';

const TokenResponseSchema = z.object({ access_token: z.string().min(1) });

/** A provider with two endpoints, taking its credentials however the test says. */
class FakeOAuth extends StandardOAuthIntegration<
  StandardOAuthConfig,
  z.infer<typeof TokenResponseSchema>
> {
  readonly name = IntegrationName.TWITCH_AUTH;
  protected readonly requiredScopes = ['read', 'write'];
  protected readonly callbackPath = '/callback/fake';
  protected readonly redirectHost = '127.0.0.1';
  protected readonly configSchema = StandardOAuthConfigSchema;
  protected readonly authorizeUrl = 'https://auth.example.com/authorize';
  protected readonly tokenUrl = 'https://auth.example.com/token';
  protected readonly tokenResponseSchema = TokenResponseSchema;

  constructor(
    protected readonly clientAuthentication: ClientAuthentication,
    stateRepo: Pick<IntegrationStateRepository, 'saveConfig'>
  ) {
    super(
      new Logger({ level: 'silent' }),
      'FakeAuth',
      stateRepo as IntegrationStateRepository,
      fake<TuringModConfig>()({ serverPort: 8080 })
    );
  }

  protected toConfigPatch(data: { access_token: string }): Partial<StandardOAuthConfig> {
    return { accessToken: data.access_token };
  }

  protected connect(): Promise<void> {
    return Promise.resolve();
  }
}

async function setup(clientAuthentication: ClientAuthentication = 'body') {
  const saveConfig = vi.fn();
  const integration = new FakeOAuth(clientAuthentication, { saveConfig });
  await integration.initialize({ clientId: 'id', clientSecret: 'secret' });
  return { integration, saveConfig };
}

/** The headers and form body of the one token request made. */
function tokenRequest() {
  const [url, init] = vi.mocked(fetch).mock.calls[0] ?? [];
  return {
    url: String(url),
    headers: new Headers(init?.headers),
    body: new URLSearchParams(String(init?.body)),
  };
}

describe('StandardOAuthIntegration', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the streamer to the authorize endpoint for exactly the required scopes', async () => {
    const { integration } = await setup();

    const url = new URL(integration.getAuthorizationUrl('state-1'));

    expect(`${url.origin}${url.pathname}`).toBe('https://auth.example.com/authorize');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'id',
      redirect_uri: 'http://127.0.0.1:8080/callback/fake',
      response_type: 'code',
      scope: 'read write',
      state: 'state-1',
    });
  });

  it('exchanges a code with the same redirect URI, and saves what comes back', async () => {
    const { integration, saveConfig } = await setup();
    vi.mocked(fetch).mockResolvedValue(Response.json({ access_token: 'token' }));

    await integration.exchangeCode('code-1');

    const { url, body } = tokenRequest();
    expect(url).toBe('https://auth.example.com/token');
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('code-1');
    expect(body.get('redirect_uri')).toBe('http://127.0.0.1:8080/callback/fake');
    expect(saveConfig).toHaveBeenCalledWith(
      IntegrationName.TWITCH_AUTH,
      expect.objectContaining({ accessToken: 'token' })
    );
  });

  it('sends the client credentials in the form body when the provider takes them there', async () => {
    const { integration } = await setup('body');
    vi.mocked(fetch).mockResolvedValue(Response.json({ access_token: 'token' }));

    await integration.exchangeCode('code-1');

    const { headers, body } = tokenRequest();
    expect(body.get('client_id')).toBe('id');
    expect(body.get('client_secret')).toBe('secret');
    expect(headers.has('Authorization')).toBe(false);
  });

  it('sends the client credentials as HTTP Basic auth when the provider takes them there', async () => {
    const { integration } = await setup('basic');
    vi.mocked(fetch).mockResolvedValue(Response.json({ access_token: 'token' }));

    await integration.exchangeCode('code-1');

    const { headers, body } = tokenRequest();
    expect(headers.get('Authorization')).toBe(
      `Basic ${Buffer.from('id:secret').toString('base64')}`
    );
    expect(body.has('client_secret')).toBe(false);
  });

  it('gives up on a token request the provider never answers', async () => {
    // Spotify shares one refresh between every caller, so one that hung would hang them all.
    const { integration, saveConfig } = await setup();
    const timeout = new AbortController();
    const timeoutFor = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal);
    vi.mocked(fetch).mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        })
    );

    const exchanged = integration.exchangeCode('code-1');
    timeout.abort(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));

    await expect(exchanged).rejects.toThrow(/timeout/);
    expect(timeoutFor).toHaveBeenCalledWith(10_000);
    expect(saveConfig).not.toHaveBeenCalled();
  });

  it('fails an exchange the provider refuses, saving nothing', async () => {
    const { integration, saveConfig } = await setup();
    vi.mocked(fetch).mockResolvedValue(new Response('invalid_grant', { status: 400 }));

    await expect(integration.exchangeCode('code-1')).rejects.toThrow(
      'Failed to exchange code: invalid_grant'
    );
    expect(saveConfig).not.toHaveBeenCalled();
  });

  it('stays disconnected until there is an access token', async () => {
    const { integration } = await setup();

    await integration.start();

    expect(integration.getStatus()).toBe(IntegrationStatus.DISCONNECTED);
  });
});
