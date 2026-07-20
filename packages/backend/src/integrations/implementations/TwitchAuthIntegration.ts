import { randomUUID } from 'node:crypto';
import { IntegrationStatus } from '@turingmod/shared';
import { HttpStatusCodeError } from '@twurple/api-call';
import type { AccessToken, RefreshingAuthProvider } from '@twurple/auth';
import {
  InvalidTokenError,
  InvalidTokenTypeError,
  RefreshingAuthProvider as TwurpleRefreshingAuthProvider,
} from '@twurple/auth';
import type { EventBus } from '../../core/EventBus.js';
import type { IntegrationStateRepository } from '../../database/repositories/IntegrationStateRepository.js';
import type { Logger } from '../../utils/Logger.js';
import { BaseIntegration } from '../BaseIntegration.js';
import type { IOAuthIntegration } from '../interfaces/IOAuthIntegration.js';
import { buildOAuthEnvConfig, validateOAuthConfig } from '../oauthConfigHelpers.js';

/**
 * Twitch Auth Configuration
 */
export interface TwitchAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
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
const TWITCH_REQUIRED_SCOPES = [
  'chat:read',
  'chat:edit',
  'user:read:chat',
  'user:write:chat',
  'channel:read:subscriptions',
  'moderator:read:followers',
  'moderator:manage:banned_users',
  'moderator:manage:chat_messages',
  'moderator:manage:warnings',
  'user:read:email',
];

const TWITCH_CALLBACK_PATH = '/callback/twitch';
const TWITCH_REDIRECT_URI = `http://localhost:8080${TWITCH_CALLBACK_PATH}`;

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
export class TwitchAuthIntegration extends BaseIntegration implements IOAuthIntegration {
  readonly name = 'twitch-auth';
  readonly version = '1.0.0';

  private authProvider: RefreshingAuthProvider | null = null;
  private config: TwitchAuthConfig | null = null;
  private userId: string | null = null;

  constructor(
    private eventBus: EventBus,
    logger: Logger,
    private stateRepo: IntegrationStateRepository
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

    this.logger.info('Starting Twitch Auth integration');
    this.setStatus(IntegrationStatus.CONNECTING);

    try {
      // Check if we have tokens
      if (!this.config.accessToken) {
        this.logger.warn('No tokens available. User must complete OAuth flow.');
        this.setStatus(IntegrationStatus.DISCONNECTED);
        this.eventBus.emit('integration.auth-required', {
          integration: this.name,
          authUrl: this.getAuthorizationUrl(
            this.config as unknown as Record<string, unknown>,
            randomUUID()
          ),
        });
        return;
      }

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

        // Emit event for other integrations
        this.eventBus.emit('twitch.auth.token-refreshed', {
          token: newToken,
        });
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

      // Emit event that auth is ready
      this.eventBus.emit('twitch.auth.ready', {
        authProvider: this.authProvider,
      });
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
    this.logger.info('Stopping Twitch Auth integration');

    this.authProvider = null;
    this.setStatus(IntegrationStatus.DISCONNECTED);

    this.logger.info('Twitch Auth integration stopped');
    return Promise.resolve();
  }

  /**
   * Get the auth provider for use by other integrations
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
      redirectUri: TWITCH_REDIRECT_URI,
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
   * Generate OAuth authorization URL
   */
  getAuthorizationUrl(config: Record<string, unknown>, state: string): string {
    const { clientId, redirectUri, scopes } = config as unknown as TwitchAuthConfig;
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: scopes.join(' '),
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
        redirect_uri: this.config.redirectUri,
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

    const updatedConfig: TwitchAuthConfig = {
      ...this.config,
      accessToken: token.accessToken,
      obtainmentTimestamp: token.obtainmentTimestamp,
    };

    // Conditionally add optional properties
    if (token.refreshToken) {
      updatedConfig.refreshToken = token.refreshToken;
    }
    if (token.expiresIn) {
      updatedConfig.expiresIn = token.expiresIn;
    }
    if (token.scope) {
      updatedConfig.scopes = token.scope;
    }

    // Update local config
    this.config = updatedConfig;

    // Save to database
    await this.stateRepo.upsert(
      this.name,
      updatedConfig as unknown as Record<string, unknown>,
      true
    );
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
