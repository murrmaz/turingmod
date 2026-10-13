import { IntegrationGroup, IntegrationStatus } from '@turingmod/shared';
import { HttpStatusCodeError } from '@twurple/api-call';
import type { AccessToken, RefreshingAuthProvider } from '@twurple/auth';
import {
  InvalidTokenError,
  InvalidTokenTypeError,
  RefreshingAuthProvider as TwurpleRefreshingAuthProvider,
} from '@twurple/auth';
import { injectable, singleton } from 'tsyringe';
import { EventBus } from '../../../core/EventBus.js';
import { IntegrationStateRepository } from '../../../database/repositories/IntegrationStateRepository.js';
import { TuringModConfig } from '../../../utils/Config.js';
import { Logger } from '../../../utils/Logger.js';
import { BaseIntegration } from '../../BaseIntegration.js';
import type { IOAuthIntegration } from '../../interfaces/IOAuthIntegration.js';
import {
  buildOAuthEnvConfig,
  oauthRedirectUri,
  persistOAuthTokens,
  validateOAuthConfig,
} from '../../oauthConfigHelpers.js';

/**
 * Twitch Auth Configuration
 */
export interface TwitchAuthConfig {
  clientId: string;
  clientSecret: string;
  scopes: string[];
  accessToken?: string;
  refreshToken?: string;
  expiresIn?: number;
  obtainmentTimestamp?: number;
}

/**
 * Required OAuth scopes for the Twitch integration.
 * Single source of truth — the frontend and OAuthHandler should not specify scopes.
 */
export const TWITCH_REQUIRED_SCOPES = [
  'chat:read',
  'chat:edit',
  'user:read:chat',
  'user:write:chat',
  'channel:read:subscriptions',
  // Changing the title, category, tags and content labels, and creating stream markers
  'channel:manage:broadcast',
  // Deleting past broadcasts (`!delvod`)
  'channel:manage:videos',
  // Ad schedule reads (Get Ad Schedule, `!ad`) and the channel.ad_break.begin EventSub topic
  'channel:read:ads',
  // Snoozing the next ad break
  'channel:manage:ads',
  // Enabling/disabling channel point rewards (e.g. pausing redemptions during an ad break)
  'channel:manage:redemptions',
  'moderator:read:followers',
  'moderator:manage:banned_users',
  'moderator:manage:chat_messages',
  'moderator:manage:warnings',
  // Native shoutouts (raid shoutouts, `!so`)
  'moderator:manage:shoutouts',
  // Highlighted chat announcements (interval messages)
  'moderator:manage:announcements',
  'user:read:email',
];

const TWITCH_CALLBACK_PATH = '/callback/twitch';
/** Twitch accepts plain-HTTP redirects only to `localhost`, not `127.0.0.1`. */
const TWITCH_REDIRECT_HOST = 'localhost';

/**
 * Twitch Auth Integration
 * Handles OAuth flow, token storage, and token refresh
 *
 * Responsibilities:
 * - OAuth authorization flow
 * - Token storage (encrypted in database)
 * - Automatic token refresh
 * - Providing valid tokens to other Twitch integrations
 */
@injectable()
@singleton()
export class TwitchAuthIntegration extends BaseIntegration implements IOAuthIntegration {
  readonly name = 'twitch-auth';
  readonly version = '1.0.0';

  private authProvider: RefreshingAuthProvider | null = null;
  private config: TwitchAuthConfig | null = null;
  private userId: string | null = null;
  private unsubscribeAuthorizationRevoked: (() => void) | null = null;

  constructor(
    private eventBus: EventBus,
    logger: Logger,
    private stateRepo: IntegrationStateRepository,
    private serverConfig: TuringModConfig
  ) {
    super(logger, { component: 'TwitchAuth' });
  }

  initialize(config: Record<string, unknown>): Promise<void> {
    this.logger.info('Initializing Twitch Auth integration');

    this.config = config as unknown as TwitchAuthConfig;
    validateOAuthConfig(this.config, this.getRequiredScopes());

    this.logger.info('Twitch Auth integration initialized');
    return Promise.resolve();
  }

  async start(): Promise<void> {
    if (!this.config) {
      throw new Error('Integration not initialized. Call initialize() first.');
    }

    this.logger.debug('Starting Twitch Auth integration');
    this.setStatus(IntegrationStatus.CONNECTING);

    try {
      // Check if we have tokens
      if (!this.config.accessToken) {
        this.logger.warn('No tokens available. User must complete OAuth flow.');
        this.setStatus(IntegrationStatus.DISCONNECTED);
        return;
      }

      // A token granted before a scope was added to TWITCH_REQUIRED_SCOPES
      // still works for everything it was granted, so nothing would fail until
      // the first call that needs the new scope — far from the cause. Refuse to
      // start on a short grant instead, so the gap shows up as NEEDS_REAUTH here.
      const missingScopes = TWITCH_REQUIRED_SCOPES.filter(
        (scope) => !(this.config?.scopes ?? []).includes(scope)
      );
      if (missingScopes.length > 0) {
        this.logger.warn('Stored Twitch grant is missing required scopes', { missingScopes });
        this.setStatus(
          IntegrationStatus.NEEDS_REAUTH,
          `Re-authorization required for new permissions: ${missingScopes.join(', ')}`
        );
        return;
      }

      // Other Twitch integrations (e.g. EventSub) can detect that Twitch
      // revoked our authorization independently of our own refresh cycle.
      // Listen rather than being told directly, so this integration decides
      // for itself how to react instead of exposing a setter for its status.
      // Unsubscribe any listener from a prior start() first: IntegrationManager
      // doesn't call stop() after a failed start(), so a retry would otherwise
      // register a duplicate on top of the still-live one.
      this.unsubscribeAuthorizationRevoked?.();
      this.unsubscribeAuthorizationRevoked = this.eventBus.on('twitch.authorizationRevoked', () => {
        this.logger.warn('Authorization revoked (reported by another integration)');
        this.setStatus(
          IntegrationStatus.NEEDS_REAUTH,
          'Twitch revoked authorization — re-authorization required'
        );
      });

      // Create auth provider
      this.authProvider = new TwurpleRefreshingAuthProvider({
        clientId: this.config.clientId,
        clientSecret: this.config.clientSecret,
      });

      // Listen for token refresh. Registered before addUserForToken() below,
      // because that call can itself trigger an immediate refresh (if the
      // stored token is already expired) and fire this event synchronously
      // from inside the call \u2014 a listener added afterwards would miss it,
      // leaving the refreshed token stranded in memory and never persisted.
      this.authProvider.onRefresh(async (_userId, newToken) => {
        this.logger.info('Access token refreshed');

        // Save new tokens to database
        await this.saveTokens(newToken);

        this.reportTokenRefreshed(
          newToken.expiresIn === null
            ? undefined
            : newToken.obtainmentTimestamp + newToken.expiresIn * 1000
        );
      });

      // Listen for token refresh failures
      this.authProvider.onRefreshFailure((_userId, error) => {
        this.logger.error('Token refresh failed', error);
        this.setStatus(
          IntegrationStatus.NEEDS_REAUTH,
          'Token refresh failed \u2014 re-authorization required'
        );
      });

      // Add user with token data (returns the authenticated user ID)
      this.userId = await this.authProvider.addUserForToken({
        accessToken: this.config.accessToken,
        refreshToken: this.config.refreshToken,
        expiresIn: this.config.expiresIn,
        obtainmentTimestamp: this.config.obtainmentTimestamp || Date.now(),
        scope: this.config.scopes,
      } as AccessToken);

      this.setStatus(IntegrationStatus.CONNECTED);
      this.logger.info('Twitch Auth integration started successfully');
    } catch (error) {
      this.logger.error('Failed to start Twitch Auth integration', error);
      if (isReauthRequiredError(error)) {
        this.setStatus(
          IntegrationStatus.NEEDS_REAUTH,
          'Refresh token is invalid or revoked — re-authorization required'
        );
      } else {
        this.setStatus(
          IntegrationStatus.ERROR,
          error instanceof Error ? error.message : 'Unknown error'
        );
      }
      throw error;
    }
  }

  stop(): Promise<void> {
    this.logger.debug('Stopping Twitch Auth integration');

    this.unsubscribeAuthorizationRevoked?.();
    this.unsubscribeAuthorizationRevoked = null;

    this.authProvider = null;
    // Clear the id alongside the provider: leaving it set made getAuthenticatedUserId()
    // report a usable broadcaster after a stop(), while every call behind it would fail.
    this.userId = null;
    this.setStatus(IntegrationStatus.DISCONNECTED);

    this.logger.debug('Twitch Auth integration stopped');
    return Promise.resolve();
  }

  getGroup(): IntegrationGroup {
    return IntegrationGroup.TWITCH;
  }

  /**
   * Get the auth provider for use by other integrations.
   *
   * Returns the stored instance, not a new one per call: dependents compare
   * this reference against the one their cached client was built on to detect
   * that the grant was replaced, so a fresh object each call would make them
   * rebuild on every access.
   */
  getAuthProvider(): RefreshingAuthProvider | null {
    return this.authProvider;
  }

  /**
   * Get the authenticated user ID
   */
  getAuthenticatedUserId(): string | null {
    return this.userId;
  }

  override get oauth(): IOAuthIntegration {
    return this;
  }

  /**
   * OAuth scopes this integration requires (IOAuthIntegration)
   */
  getRequiredScopes(): string[] {
    return TWITCH_REQUIRED_SCOPES;
  }

  /**
   * Build a config from environment variables, for first-time setup before
   * any config has been saved to the database (IOAuthIntegration).
   */
  getEnvConfig(): Record<string, unknown> {
    return buildOAuthEnvConfig<TwitchAuthConfig>({
      providerLabel: 'Twitch',
      clientIdEnvVar: 'TWITCH_CLIENT_ID',
      clientSecretEnvVar: 'TWITCH_CLIENT_SECRET',
      scopes: TWITCH_REQUIRED_SCOPES,
    }) as unknown as Record<string, unknown>;
  }

  /**
   * HTTP path this integration's OAuth redirect URI points at (IOAuthIntegration)
   */
  getCallbackPath(): string {
    return TWITCH_CALLBACK_PATH;
  }

  /**
   * OAuth redirect URI (IOAuthIntegration)
   */
  getRedirectUri(): string {
    return oauthRedirectUri(
      TWITCH_REDIRECT_HOST,
      this.serverConfig.serverPort,
      TWITCH_CALLBACK_PATH
    );
  }

  /**
   * Generate OAuth authorization URL
   */
  getAuthorizationUrl(config: Record<string, unknown>, state: string): string {
    // Always request the current required set rather than config.scopes:
    // after the first grant, config.scopes records what Twitch *granted*, so
    // reusing it would re-request the old set and never pick up added scopes.
    const { clientId } = config as unknown as TwitchAuthConfig;
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: this.getRedirectUri(),
      response_type: 'code',
      scope: TWITCH_REQUIRED_SCOPES.join(' '),
      state,
    });

    return `https://id.twitch.tv/oauth2/authorize?${params.toString()}`;
  }

  /**
   * Exchange authorization code for tokens
   */
  async exchangeCode(code: string): Promise<AccessToken> {
    if (!this.config) {
      throw new Error('Integration not initialized');
    }

    this.logger.info('Exchanging authorization code for tokens');

    const response = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: this.getRedirectUri(),
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to exchange code: ${error}`);
    }

    const data = (await response.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      scope: string[];
    };

    const token: AccessToken = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || null,
      expiresIn: data.expires_in || null,
      obtainmentTimestamp: Date.now(),
      scope: data.scope,
    };

    // Save tokens
    await this.saveTokens(token);

    this.logger.info('Successfully exchanged code for tokens');

    return token;
  }

  /**
   * Save tokens to database
   */
  private async saveTokens(token: AccessToken): Promise<void> {
    if (!this.config) {
      throw new Error('Integration not initialized');
    }

    // Conditionally include optional properties (exactOptionalPropertyTypes)
    const patch: Partial<TwitchAuthConfig> = {
      accessToken: token.accessToken,
      obtainmentTimestamp: token.obtainmentTimestamp,
    };
    if (token.refreshToken) {
      patch.refreshToken = token.refreshToken;
    }
    if (token.expiresIn) {
      patch.expiresIn = token.expiresIn;
    }
    if (token.scope) {
      patch.scopes = token.scope;
    }

    this.config = await persistOAuthTokens(this.stateRepo, this.name, this.config, patch);
  }
}

/**
 * Whether a `start()` failure means the refresh token itself is dead (revoked
 * or expired) rather than some transient/unexpected error. Twurple throws
 * `InvalidTokenError`/`InvalidTokenTypeError` directly for a missing or
 * malformed token; a dead refresh token surfaces as Twitch's token endpoint
 * rejecting the refresh request with an HTTP 400.
 */
function isReauthRequiredError(error: unknown): boolean {
  if (error instanceof InvalidTokenError || error instanceof InvalidTokenTypeError) {
    return true;
  }
  return error instanceof HttpStatusCodeError && error.statusCode === 400;
}
