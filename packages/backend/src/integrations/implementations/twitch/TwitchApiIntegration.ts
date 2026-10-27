import { IntegrationName, IntegrationStatus } from '@turingmod/shared';
import { ApiClient } from '@twurple/api';
import { HttpStatusCodeError } from '@twurple/api-call';
import { CachedRefreshFailureError, type RefreshingAuthProvider } from '@twurple/auth';
import { singleton } from 'tsyringe';
import { EventBus } from '../../../core/EventBus.js';
import { Logger } from '../../../utils/Logger.js';
import { AuthorizedApiIntegration } from '../../AuthorizedApiIntegration.js';
import { ClientCache } from '../../ClientCache.js';
import { TwitchAuthIntegration } from './TwitchAuthIntegration.js';

/**
 * The Twitch Helix connection: a Twurple `ApiClient` kept in step with
 * TwitchAuthIntegration (see AuthorizedApiIntegration).
 *
 * Knows nothing about what a call is for: every Twitch endpoint and Twitch
 * rule TuringMod uses (game search, snooze checks, shoutout cooldowns) lives
 * in TwitchPlatform, which makes its calls through request(). Its own part is
 * noticing when Twitch says the grant is gone.
 *
 * Depends on: TwitchAuthIntegration
 */
@singleton()
export class TwitchApiIntegration extends AuthorizedApiIntegration<
  TwitchAuthIntegration,
  ApiClient
> {
  readonly name = IntegrationName.TWITCH_API;

  private readonly clients = new ClientCache(
    (authProvider: RefreshingAuthProvider) => new ApiClient({ authProvider }),
    () => this.logger.info('Twitch auth provider was replaced; rebuilding API client')
  );

  constructor(
    private eventBus: EventBus,
    logger: Logger,
    authIntegration: TwitchAuthIntegration
  ) {
    super(logger, 'Twitch', authIntegration);
  }

  /**
   * The current client, for something that must hold one for its own
   * lifetime (TwitchEventSubIntegration's listener). Make individual calls
   * through request() instead, which reports a revoked grant.
   */
  getApiClient(): ApiClient | null {
    return this.currentClient();
  }

  protected resolveClient(): ApiClient | null {
    const authProvider = this.auth.getAuthProvider();
    return authProvider ? this.clients.get(authProvider) : null;
  }

  protected override forgetClient(): void {
    this.clients.clear();
  }

  /**
   * When Twitch rejects the call because the OAuth grant itself is gone (not
   * some other API error), marks this integration NEEDS_REAUTH and publishes
   * `twitch.authorizationRevoked`, the same way TwitchEventSubIntegration
   * does, rather than reaching into TwitchAuthIntegration directly.
   */
  protected override onRequestFailure<T>(error: unknown): Promise<T> {
    if (isAuthorizationRevokedError(error)) {
      this.setStatus(
        IntegrationStatus.NEEDS_REAUTH,
        'Twitch rejected an API call as unauthorized — re-authorization required'
      );
      this.eventBus.emit('twitch.authorizationRevoked', { reason: 'api-call-unauthorized' });
    }
    return Promise.reject(error);
  }
}

/**
 * Whether a Helix API call failure means the OAuth grant itself is dead,
 * rather than some unrelated API error (rate limit, bad request, 404, etc.).
 * `CachedRefreshFailureError` means Twurple already knows this user's token
 * can't be refreshed; a 401 means Twitch rejected this specific request as
 * unauthorized.
 */
function isAuthorizationRevokedError(error: unknown): boolean {
  if (error instanceof CachedRefreshFailureError) {
    return true;
  }
  return error instanceof HttpStatusCodeError && error.statusCode === 401;
}
