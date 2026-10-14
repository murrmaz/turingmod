import { IntegrationGroup, IntegrationStatus, messageOf } from '@turingmod/shared';
import { ApiClient } from '@twurple/api';
import { HttpStatusCodeError } from '@twurple/api-call';
import { CachedRefreshFailureError, type RefreshingAuthProvider } from '@twurple/auth';
import { injectable, singleton } from 'tsyringe';
import { EventBus } from '../../../core/EventBus.js';
import { Logger } from '../../../utils/Logger.js';
import { BaseIntegration } from '../../BaseIntegration.js';
import { DependencyFailurePolicy, type IIntegration } from '../../interfaces/IIntegration.js';
import { TwitchAuthIntegration } from './TwitchAuthIntegration.js';

/**
 * The Twitch Helix connection: a Twurple `ApiClient` kept in step with
 * TwitchAuthIntegration, and the integration status that says whether it can
 * be used.
 *
 * Owns connection health only — which client to use, whether auth is usable,
 * and noticing when Twitch says the grant is gone. It knows nothing about
 * what a call is for: every Twitch endpoint and Twitch rule TuringMod uses
 * (game search, snooze checks, shoutout cooldowns) lives in TwitchPlatform,
 * which makes its calls through request().
 *
 * Depends on: TwitchAuthIntegration
 */
@injectable()
@singleton()
export class TwitchApiIntegration extends BaseIntegration {
  readonly name = 'twitch-api';

  private apiClient: ApiClient | null = null;
  private authProvider: RefreshingAuthProvider | null = null;

  constructor(
    private eventBus: EventBus,
    logger: Logger,
    private authIntegration: TwitchAuthIntegration
  ) {
    super(logger, { component: 'TwitchAPI' });
  }

  /**
   * Get integration dependencies
   */
  getDependencies(): IIntegration[] {
    return [this.authIntegration];
  }

  /**
   * Holds nothing bound to the auth grant — the client is resolved on access —
   * so a Twitch auth failure blocks this integration rather than stopping it:
   * there is nothing to tear down, and request() already refuses to call
   * Twitch until auth is connected again.
   */
  override get dependencyFailurePolicy(): DependencyFailurePolicy {
    return DependencyFailurePolicy.BLOCK;
  }

  getGroup(): IntegrationGroup {
    return IntegrationGroup.TWITCH;
  }

  start(): Promise<void> {
    this.logger.debug('Starting Twitch API integration');
    this.setStatus(IntegrationStatus.CONNECTING);

    try {
      const apiClient = this.resolveApiClient();

      if (!apiClient) {
        throw new Error('TwitchAuthIntegration must be started before TwitchApiIntegration');
      }

      this.setStatus(IntegrationStatus.CONNECTED);
      this.logger.info('Twitch API integration started successfully (auth provider configured)');

      return Promise.resolve();
    } catch (error) {
      this.logger.error('Failed to start Twitch API integration', error);
      this.setStatus(IntegrationStatus.ERROR, messageOf(error));
      throw error;
    }
  }

  stop(): Promise<void> {
    this.logger.debug('Stopping Twitch API integration');

    this.apiClient = null;
    this.authProvider = null;
    this.setStatus(IntegrationStatus.DISCONNECTED);

    this.logger.debug('Twitch API integration stopped');
    return Promise.resolve();
  }

  /**
   * The current client, for something that must hold one for its own
   * lifetime (TwitchEventSubIntegration's listener). Make individual calls
   * through request() instead, which reports a revoked grant.
   */
  getApiClient(): ApiClient | null {
    return this.resolveApiClient();
  }

  /**
   * Return a client built on the auth integration's *current* auth provider,
   * rebuilding it if the provider has been replaced since.
   *
   * TwitchAuthIntegration creates a fresh RefreshingAuthProvider every time it
   * starts, so a client captured once at start() would keep calling Twitch
   * through a provider that can no longer refresh — silently, until the access
   * token aged out. Resolving on access instead means the stale-reference case
   * cannot arise, rather than being swept up afterwards by the manager's
   * cascade. (The cascade still matters for the EventSub listener, which owns
   * its provider for the life of its WebSocket and cannot be re-pointed.)
   */
  private resolveApiClient(): ApiClient | null {
    // Refuse to act at all while auth isn't connected. markAuthRequired()
    // sets NEEDS_REAUTH without discarding the provider, so the provider
    // below can be perfectly non-null and still unable to refresh — which is
    // what would make a BLOCK-policy integration keep calling Twitch with
    // credentials it has already been told are dead.
    const authProvider =
      this.authIntegration.getStatus() === IntegrationStatus.CONNECTED
        ? this.authIntegration.getAuthProvider()
        : null;

    if (!authProvider) {
      this.apiClient = null;
      this.authProvider = null;
      return null;
    }

    if (this.apiClient && this.authProvider === authProvider) {
      return this.apiClient;
    }

    if (this.authProvider) {
      this.logger.info('Twitch auth provider was replaced; rebuilding API client');
    }

    this.authProvider = authProvider;
    this.apiClient = new ApiClient({ authProvider });
    return this.apiClient;
  }

  /**
   * Run a Helix call through the current client. Throws if auth isn't
   * connected. When Twitch rejects the call because the OAuth grant itself is
   * gone (not some other API error), marks this integration NEEDS_REAUTH and
   * publishes `twitch.authorizationRevoked`, the same way
   * TwitchEventSubIntegration does, rather than reaching into
   * TwitchAuthIntegration directly.
   */
  async request<T>(fn: (apiClient: ApiClient) => Promise<T>): Promise<T> {
    const apiClient = this.resolveApiClient();
    if (!apiClient) {
      throw new Error('API client not initialized');
    }

    try {
      return await fn(apiClient);
    } catch (error) {
      if (isAuthorizationRevokedError(error)) {
        this.setStatus(
          IntegrationStatus.NEEDS_REAUTH,
          'Twitch rejected an API call as unauthorized — re-authorization required'
        );
        this.eventBus.emit('twitch.authorizationRevoked', { reason: 'api-call-unauthorized' });
      }
      throw error;
    }
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
