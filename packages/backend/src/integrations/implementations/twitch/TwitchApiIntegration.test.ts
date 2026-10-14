import 'reflect-metadata';
import { IntegrationStatus } from '@turingmod/shared';
import { HttpStatusCodeError } from '@twurple/api-call';
import { CachedRefreshFailureError, type RefreshingAuthProvider } from '@twurple/auth';
import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../../core/EventBus.js';
import { Logger } from '../../../utils/Logger.js';
import { TwitchApiIntegration } from './TwitchApiIntegration.js';
import type { TwitchAuthIntegration } from './TwitchAuthIntegration.js';

/**
 * A connected auth integration.
 *
 * Two details mirror the real one and both matter to TwitchApiIntegration:
 * it hands out the *same* provider instance every call (a different reference
 * means "the grant was replaced", and the client is rebuilt), and it reports
 * its status (the API layer refuses to resolve a client unless auth is
 * CONNECTED, since a provider can be non-null and still unable to refresh).
 */
function makeAuthIntegration(
  status: IntegrationStatus = IntegrationStatus.CONNECTED
): TwitchAuthIntegration {
  const authProvider = {} as RefreshingAuthProvider;
  return {
    getStatus: () => status,
    getAuthProvider: () => authProvider,
  } as unknown as TwitchAuthIntegration;
}

async function startWithFailingCall(
  eventBus: EventBus,
  error: unknown
): Promise<TwitchApiIntegration> {
  const integration = new TwitchApiIntegration(
    eventBus,
    new Logger({ level: 'silent' }),
    makeAuthIntegration()
  );

  await integration.start();

  const apiClient = integration.getApiClient();
  if (!apiClient) {
    throw new Error('apiClient unexpectedly null after start()');
  }
  vi.spyOn(apiClient.users, 'getUserByName').mockRejectedValue(error);

  return integration;
}

describe('TwitchApiIntegration', () => {
  it('refuses to resolve a client while auth is not connected', async () => {
    const integration = new TwitchApiIntegration(
      new EventBus(new Logger({ level: 'silent' })),
      new Logger({ level: 'silent' }),
      makeAuthIntegration(IntegrationStatus.CONNECTED)
    );
    await integration.start();
    expect(integration.getApiClient()).not.toBeNull();

    // A provider that is still non-null but can no longer refresh: the
    // integration must not keep calling Twitch through it.
    const reauthing = new TwitchApiIntegration(
      new EventBus(new Logger({ level: 'silent' })),
      new Logger({ level: 'silent' }),
      makeAuthIntegration(IntegrationStatus.NEEDS_REAUTH)
    );
    expect(reauthing.getApiClient()).toBeNull();
    await expect(reauthing.request((c) => c.users.getUserByName('someone'))).rejects.toThrow(
      /client not initialized/
    );
  });

  it('rebuilds its client when the auth provider is replaced', async () => {
    let authProvider = {} as RefreshingAuthProvider;
    const authIntegration = {
      getStatus: () => IntegrationStatus.CONNECTED,
      getAuthProvider: () => authProvider,
    } as unknown as TwitchAuthIntegration;

    const integration = new TwitchApiIntegration(
      new EventBus(new Logger({ level: 'silent' })),
      new Logger({ level: 'silent' }),
      authIntegration
    );

    await integration.start();
    const firstClient = integration.getApiClient();

    // Same provider -> same client, so callers aren't handed a new object per access.
    expect(integration.getApiClient()).toBe(firstClient);

    // Re-authorizing swaps the provider; the client must follow rather than
    // keep calling Twitch through credentials that can no longer refresh.
    authProvider = {} as RefreshingAuthProvider;
    expect(integration.getApiClient()).not.toBe(firstClient);
  });

  it('reports no client once the auth provider is gone', async () => {
    let authProvider: RefreshingAuthProvider | null = {} as RefreshingAuthProvider;
    const authIntegration = {
      getStatus: () => IntegrationStatus.CONNECTED,
      getAuthProvider: () => authProvider,
    } as unknown as TwitchAuthIntegration;

    const integration = new TwitchApiIntegration(
      new EventBus(new Logger({ level: 'silent' })),
      new Logger({ level: 'silent' }),
      authIntegration
    );

    await integration.start();
    expect(integration.getApiClient()).not.toBeNull();

    authProvider = null;
    expect(integration.getApiClient()).toBeNull();
  });

  it('marks itself NEEDS_REAUTH and reports authorizationRevoked on a 401', async () => {
    const eventBus = new EventBus(new Logger({ level: 'silent' }));
    const revoked = vi.fn();
    eventBus.on('twitch.authorizationRevoked', revoked);

    const integration = await startWithFailingCall(
      eventBus,
      new HttpStatusCodeError(
        401,
        'Unauthorized',
        'https://api.twitch.tv/helix/users',
        'GET',
        '',
        true
      )
    );

    await expect(integration.request((c) => c.users.getUserByName('someone'))).rejects.toThrow();

    expect(integration.getStatus()).toBe(IntegrationStatus.NEEDS_REAUTH);
    expect(revoked).toHaveBeenCalledWith({ reason: 'api-call-unauthorized' });
  });

  it('marks itself NEEDS_REAUTH when Twurple already knows the token refresh failed', async () => {
    const eventBus = new EventBus(new Logger({ level: 'silent' }));
    const revoked = vi.fn();
    eventBus.on('twitch.authorizationRevoked', revoked);

    const integration = await startWithFailingCall(
      eventBus,
      new CachedRefreshFailureError('user-123')
    );

    await expect(integration.request((c) => c.users.getUserByName('someone'))).rejects.toThrow();

    expect(integration.getStatus()).toBe(IntegrationStatus.NEEDS_REAUTH);
    expect(revoked).toHaveBeenCalledWith({ reason: 'api-call-unauthorized' });
  });

  it('does not report authorizationRevoked for unrelated API errors', async () => {
    const eventBus = new EventBus(new Logger({ level: 'silent' }));
    const revoked = vi.fn();
    eventBus.on('twitch.authorizationRevoked', revoked);

    const integration = await startWithFailingCall(
      eventBus,
      new HttpStatusCodeError(
        429,
        'Too Many Requests',
        'https://api.twitch.tv/helix/users',
        'GET',
        '',
        true
      )
    );

    await expect(integration.request((c) => c.users.getUserByName('someone'))).rejects.toThrow();

    expect(integration.getStatus()).toBe(IntegrationStatus.CONNECTED);
    expect(revoked).not.toHaveBeenCalled();
  });
});
