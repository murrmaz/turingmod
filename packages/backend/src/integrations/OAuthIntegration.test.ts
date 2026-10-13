import 'reflect-metadata';
import { IntegrationStatus } from '@turingmod/shared';
import { describe, expect, it, vi } from 'vitest';
import type { IntegrationStateRepository } from '../database/repositories/IntegrationStateRepository.js';
import type { TuringModConfig } from '../utils/Config.js';
import { Logger } from '../utils/Logger.js';
import { type OAuthConfigBase, OAuthIntegration, parseScopes } from './OAuthIntegration.js';

interface TestConfig extends OAuthConfigBase {
  accessToken?: string;
}

/** A provider whose connect() and re-auth classification the test controls. */
class TestOAuthIntegration extends OAuthIntegration<TestConfig> {
  readonly name = 'test-auth';
  protected readonly requiredScopes = ['read', 'write'];
  protected readonly callbackPath = '/callback/test';
  protected readonly redirectHost = '127.0.0.1';

  connectImpl = vi.fn((_config: TestConfig) => Promise.resolve());
  reauthErrors = new Set<unknown>();

  constructor(upsert: IntegrationStateRepository['upsert'] = vi.fn()) {
    super(
      new Logger({ level: 'silent' }),
      'TestAuth',
      { upsert } as unknown as IntegrationStateRepository,
      { serverPort: 9123 } as TuringModConfig
    );
  }

  getAuthorizationUrl(state: string): string {
    return state;
  }

  exchangeCode(): Promise<void> {
    return Promise.resolve();
  }

  /** Simulates a refresh listener nobody awaits. */
  refreshed(patch: Partial<TestConfig>): void {
    this.saveRefreshedTokens(patch);
  }

  protected hasTokens(config: TestConfig): boolean {
    return Boolean(config.accessToken);
  }

  protected connect(config: TestConfig): Promise<void> {
    return this.connectImpl(config);
  }

  protected override isReauthRequiredError(error: unknown): boolean {
    return this.reauthErrors.has(error);
  }
}

const CREDENTIALS = { clientId: 'id', clientSecret: 'secret' };
const GRANT = { ...CREDENTIALS, accessToken: 'token', grantedScopes: ['read', 'write'] };

describe('OAuthIntegration', () => {
  it('rejects a config without client credentials', () => {
    const integration = new TestOAuthIntegration();

    expect(() => integration.initialize({ clientId: 'id' })).toThrow(/clientSecret/);
    expect(integration.isConfigured()).toBe(false);
  });

  it('derives its redirect URI from the server port and the provider host', () => {
    expect(new TestOAuthIntegration().getRedirectUri()).toBe('http://127.0.0.1:9123/callback/test');
  });

  it('stays disconnected until the user has authorized', async () => {
    const integration = new TestOAuthIntegration();
    await integration.initialize(CREDENTIALS);

    await integration.start();

    expect(integration.getStatus()).toBe(IntegrationStatus.DISCONNECTED);
    expect(integration.connectImpl).not.toHaveBeenCalled();
  });

  it('requires re-authorization, without connecting, when the grant is missing a required scope', async () => {
    const integration = new TestOAuthIntegration();
    await integration.initialize({ ...GRANT, grantedScopes: ['read'] });

    await integration.start();

    expect(integration.getStatus()).toBe(IntegrationStatus.NEEDS_REAUTH);
    expect(integration.getErrorMessage()).toMatch(/write/);
    expect(integration.connectImpl).not.toHaveBeenCalled();
  });

  it('treats a grant stored without its scopes as missing them', async () => {
    const integration = new TestOAuthIntegration();
    await integration.initialize({ ...CREDENTIALS, accessToken: 'token' });

    await integration.start();

    expect(integration.getStatus()).toBe(IntegrationStatus.NEEDS_REAUTH);
  });

  it('connects with a complete grant', async () => {
    const integration = new TestOAuthIntegration();
    await integration.initialize(GRANT);

    await integration.start();

    expect(integration.connectImpl).toHaveBeenCalledWith(GRANT);
    expect(integration.getStatus()).toBe(IntegrationStatus.CONNECTED);
  });

  it('reports ERROR and rethrows when connecting fails', async () => {
    const integration = new TestOAuthIntegration();
    integration.connectImpl.mockRejectedValue(new Error('network down'));
    await integration.initialize(GRANT);

    await expect(integration.start()).rejects.toThrow('network down');

    expect(integration.getStatus()).toBe(IntegrationStatus.ERROR);
    expect(integration.getErrorMessage()).toBe('network down');
  });

  it('reports NEEDS_REAUTH when the provider says the grant is dead', async () => {
    const integration = new TestOAuthIntegration();
    const dead = new Error('invalid_grant');
    integration.reauthErrors.add(dead);
    integration.connectImpl.mockRejectedValue(dead);
    await integration.initialize(GRANT);

    await expect(integration.start()).rejects.toBe(dead);

    expect(integration.getStatus()).toBe(IntegrationStatus.NEEDS_REAUTH);
  });

  it('keeps refreshed tokens in use, without throwing into the refresh listener, when storing them fails', async () => {
    const upsert = vi.fn(() => {
      throw new Error('database is locked');
    });
    const integration = new TestOAuthIntegration(upsert);
    await integration.initialize(GRANT);

    expect(() => integration.refreshed({ accessToken: 'new-token' })).not.toThrow();

    expect(upsert).toHaveBeenCalledWith(
      'test-auth',
      expect.objectContaining({ accessToken: 'new-token' }),
      true
    );
    await integration.start();
    expect(integration.connectImpl).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: 'new-token' })
    );
  });

  it('reads the space-separated scope of a token response', () => {
    expect(parseScopes('read  write')).toEqual(['read', 'write']);
    expect(parseScopes(undefined)).toBeUndefined();
    expect(parseScopes('')).toBeUndefined();
  });
});
