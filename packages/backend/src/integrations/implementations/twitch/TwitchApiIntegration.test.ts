import 'reflect-metadata';
import { IntegrationStatus } from '@turingmod/shared';
import { HttpStatusCodeError } from '@twurple/api-call';
import { CachedRefreshFailureError, type RefreshingAuthProvider } from '@twurple/auth';
import { describe, expect, it, vi } from 'vitest';
import { fake } from '../../../testing.js';
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
  const authProvider = fake<RefreshingAuthProvider>()({});
  return fake<TwitchAuthIntegration>()({
    getStatus: () => status,
    getAuthProvider: () => authProvider,
    markAuthRequired: vi.fn(),
  });
}

async function startWithFailingCall(
  error: unknown,
  auth = makeAuthIntegration()
): Promise<TwitchApiIntegration> {
  const integration = new TwitchApiIntegration(new Logger({ level: 'silent' }), auth);

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
      new Logger({ level: 'silent' }),
      makeAuthIntegration(IntegrationStatus.CONNECTED)
    );
    await integration.start();
    expect(integration.getApiClient()).not.toBeNull();

    // A provider that is still non-null but can no longer refresh: the
    // integration must not keep calling Twitch through it.
    const provider = fake<RefreshingAuthProvider>()({});
    const auth = fake<TwitchAuthIntegration>()({
      status: IntegrationStatus.CONNECTED,
      getStatus: (): IntegrationStatus => auth.status,
      getAuthProvider: () => provider,
    });
    const reauthing = new TwitchApiIntegration(new Logger({ level: 'silent' }), auth);
    await reauthing.start();
    auth.status = IntegrationStatus.NEEDS_REAUTH;
    expect(reauthing.getApiClient()).toBeNull();
    await expect(reauthing.request((c) => c.users.getUserByName('someone'))).rejects.toThrow(
      'Twitch is not connected'
    );
  });

  it('hands out no client once stopped, so a listener cannot outlive the stop', async () => {
    const integration = new TwitchApiIntegration(
      new Logger({ level: 'silent' }),
      makeAuthIntegration()
    );
    await integration.start();

    await integration.stop();

    expect(integration.getApiClient()).toBeNull();
  });

  it('rebuilds its client when the auth provider is replaced', async () => {
    let authProvider = fake<RefreshingAuthProvider>()({});
    const authIntegration = fake<TwitchAuthIntegration>()({
      getStatus: () => IntegrationStatus.CONNECTED,
      getAuthProvider: () => authProvider,
    });

    const integration = new TwitchApiIntegration(new Logger({ level: 'silent' }), authIntegration);

    await integration.start();
    const firstClient = integration.getApiClient();

    // Same provider -> same client, so callers aren't handed a new object per access.
    expect(integration.getApiClient()).toBe(firstClient);

    // Re-authorizing swaps the provider; the client must follow rather than
    // keep calling Twitch through credentials that can no longer refresh.
    authProvider = fake<RefreshingAuthProvider>()({});
    expect(integration.getApiClient()).not.toBe(firstClient);
  });

  it('reports no client once the auth provider is gone', async () => {
    let authProvider: RefreshingAuthProvider | null = fake<RefreshingAuthProvider>()({});
    const authIntegration = fake<TwitchAuthIntegration>()({
      getStatus: () => IntegrationStatus.CONNECTED,
      getAuthProvider: () => authProvider,
    });

    const integration = new TwitchApiIntegration(new Logger({ level: 'silent' }), authIntegration);

    await integration.start();
    expect(integration.getApiClient()).not.toBeNull();

    authProvider = null;
    expect(integration.getApiClient()).toBeNull();
  });

  it('keeps the client secret out of a failed app token request', async () => {
    const integration = await startWithFailingCall(
      new HttpStatusCodeError(
        503,
        'Service Unavailable',
        'token?grant_type=client_credentials&client_id=client-id&client_secret=hunter2',
        'POST',
        '',
        true
      )
    );

    const error: HttpStatusCodeError = await integration
      .request((c) => c.users.getUserByName('someone'))
      .then(
        () => expect.unreachable('the call should fail'),
        (rejected) => rejected
      );

    expect(error.statusCode).toBe(503);
    expect(error.message).toContain('client_secret=<redacted>');
    expect(`${error.message} ${error.stack} ${error.url}`).not.toContain('hunter2');
    expect(integration.getStatus()).toBe(IntegrationStatus.CONNECTED);
  });

  it('tells the auth integration the grant is dead on a 401', async () => {
    const auth = makeAuthIntegration();
    const integration = await startWithFailingCall(
      new HttpStatusCodeError(
        401,
        'Unauthorized',
        'https://api.twitch.tv/helix/users',
        'GET',
        '',
        true
      ),
      auth
    );

    await expect(integration.request((c) => c.users.getUserByName('someone'))).rejects.toThrow();

    expect(auth.markAuthRequired).toHaveBeenCalledWith(
      'Twitch rejected an API call as unauthorized — re-authorization required'
    );
    // Whose grant it is decides its status; this one follows through the cascade.
    expect(integration.getStatus()).toBe(IntegrationStatus.CONNECTED);
  });

  it('tells the auth integration when Twurple already knows the token refresh failed', async () => {
    const auth = makeAuthIntegration();
    const integration = await startWithFailingCall(new CachedRefreshFailureError('user-123'), auth);

    await expect(integration.request((c) => c.users.getUserByName('someone'))).rejects.toThrow();

    expect(auth.markAuthRequired).toHaveBeenCalledOnce();
  });

  it('says nothing about the grant for unrelated API errors', async () => {
    const auth = makeAuthIntegration();
    const integration = await startWithFailingCall(
      new HttpStatusCodeError(
        429,
        'Too Many Requests',
        'https://api.twitch.tv/helix/users',
        'GET',
        '',
        true
      ),
      auth
    );

    await expect(integration.request((c) => c.users.getUserByName('someone'))).rejects.toThrow();

    expect(integration.getStatus()).toBe(IntegrationStatus.CONNECTED);
    expect(auth.markAuthRequired).not.toHaveBeenCalled();
  });
});
