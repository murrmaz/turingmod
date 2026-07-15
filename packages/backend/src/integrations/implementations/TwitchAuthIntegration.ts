import { IntegrationStatus } from '@turingmod/shared';
import type { AccessToken, RefreshingAuthProvider } from '@twurple/auth';
import { RefreshingAuthProvider as TwurpleRefreshingAuthProvider } from '@twurple/auth';
import type { EventBus } from '../../core/EventBus.js';
import type { IntegrationStateRepository } from '../../database/repositories/IntegrationStateRepository.js';
import type { Logger } from '../../utils/Logger.js';
import { BaseIntegration } from '../BaseIntegration.js';
import type { IOAuthIntegration } from '../interfaces/IOAuthIntegration.js';

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

const TWITCH_REDIRECT_URI = 'http://localhost:8080/callback/twitch';

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
    super(logger, { integration: 'TwitchAuth' });
  }

  initialize(config: Record<string, unknown>): Promise<void> {
    this.logger.info('Initializing Twitch Auth integration');

    this.config = config as unknown as TwitchAuthConfig;

    // Validate config
    if (!(this.config.clientId && this.config.clientSecret)) {
      throw new Error('Missing clientId or clientSecret in configuration');
    }

    // Callers (e.g. the setup UI) intentionally omit scopes — this integration
    // is the single source of truth for them. Fill them in so getAuthorizationUrl()
    // never sees an undefined/empty scopes array.
    if (!this.config.scopes || this.config.scopes.length === 0) {
      this.config.scopes = this.getRequiredScopes();
    }

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
          authUrl: this.getAuthorizationUrl(this.config as unknown as Record<string, unknown>),
        });
        return;
      }

      // Create auth provider
      this.authProvider = new TwurpleRefreshingAuthProvider({
        clientId: this.config.clientId,
        clientSecret: this.config.clientSecret,
      });

      // Add user with token data (returns the authenticated user ID)
      this.userId = await this.authProvider.addUserForToken({
        accessToken: this.config.accessToken,
        refreshToken: this.config.refreshToken,
        expiresIn: this.config.expiresIn,
        obtainmentTimestamp: this.config.obtainmentTimestamp || Date.now(),
        scope: this.config.scopes,
      } as AccessToken);

      // Listen for token refresh
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
          IntegrationStatus.ERROR,
          'Token refresh failed \u2014 re-authorization required'
        );
        if (this.config) {
          this.eventBus.emit('integration.auth-required', {
            integration: this.name,
            authUrl: this.getAuthorizationUrl(this.config as unknown as Record<string, unknown>),
          });
        }
      });

      this.setStatus(IntegrationStatus.CONNECTED);
      this.logger.info('Twitch Auth integration started successfully');

      // Emit event that auth is ready
      this.eventBus.emit('twitch.auth.ready', {
        authProvider: this.authProvider,
      });
    } catch (error) {
      this.logger.error('Failed to start Twitch Auth integration', error);
      this.setStatus(
        IntegrationStatus.ERROR,
        error instanceof Error ? error.message : 'Unknown error'
      );
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
    const config: TwitchAuthConfig = {
      clientId: process.env.TWITCH_CLIENT_ID || '',
      clientSecret: process.env.TWITCH_CLIENT_SECRET || '',
      redirectUri: TWITCH_REDIRECT_URI,
      scopes: TWITCH_REQUIRED_SCOPES,
    };

    if (!(config.clientId && config.clientSecret)) {
      throw new Error(
        'Twitch credentials not configured. Please configure Client ID and Client Secret.'
      );
    }

    return config as unknown as Record<string, unknown>;
  }

  /**
   * Generate OAuth authorization URL
   */
  getAuthorizationUrl(config: Record<string, unknown>): string {
    const { clientId, redirectUri, scopes } = config as unknown as TwitchAuthConfig;
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: scopes.join(' '),
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
