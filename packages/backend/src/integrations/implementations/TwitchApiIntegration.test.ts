import { IntegrationStatus } from '@turingmod/shared';
import { HttpStatusCodeError } from '@twurple/api-call';
import { CachedRefreshFailureError, type RefreshingAuthProvider } from '@twurple/auth';
import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../core/EventBus.js';
import { Logger } from '../../utils/Logger.js';
import { TwitchApiIntegration } from './TwitchApiIntegration.js';
import type { TwitchAuthIntegration } from './TwitchAuthIntegration.js';

function makeAuthIntegration(): TwitchAuthIntegration {
  return {
    getAuthProvider: () => ({}) as RefreshingAuthProvider,
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
  it('marks itself NEEDS_REAUTH and reports authorization-revoked on a 401', async () => {
    const eventBus = new EventBus();
    const revoked = vi.fn();
    eventBus.on('twitch.authorization-revoked', revoked);

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

    await expect(integration.getUserByName('someone')).rejects.toThrow();

    expect(integration.getStatus()).toBe(IntegrationStatus.NEEDS_REAUTH);
    expect(revoked).toHaveBeenCalledWith({ reason: 'api-call-unauthorized' });
  });

  it('marks itself NEEDS_REAUTH when Twurple already knows the token refresh failed', async () => {
    const eventBus = new EventBus();
    const revoked = vi.fn();
    eventBus.on('twitch.authorization-revoked', revoked);

    const integration = await startWithFailingCall(
      eventBus,
      new CachedRefreshFailureError('user-123')
    );

    await expect(integration.getUserByName('someone')).rejects.toThrow();

    expect(integration.getStatus()).toBe(IntegrationStatus.NEEDS_REAUTH);
    expect(revoked).toHaveBeenCalledWith({ reason: 'api-call-unauthorized' });
  });

  it('does not report authorization-revoked for unrelated API errors', async () => {
    const eventBus = new EventBus();
    const revoked = vi.fn();
    eventBus.on('twitch.authorization-revoked', revoked);

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

    await expect(integration.getUserByName('someone')).rejects.toThrow();

    expect(integration.getStatus()).toBe(IntegrationStatus.CONNECTED);
    expect(revoked).not.toHaveBeenCalled();
  });
});
