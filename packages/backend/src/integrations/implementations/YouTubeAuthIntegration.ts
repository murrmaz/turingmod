import { randomUUID } from 'node:crypto';
import { IntegrationStatus } from '@turingmod/shared';
import { google } from 'googleapis';
import type { EventBus } from '../../core/EventBus.js';
import type { IntegrationStateRepository } from '../../database/repositories/IntegrationStateRepository.js';
import type { Logger } from '../../utils/Logger.js';
import { BaseIntegration } from '../BaseIntegration.js';
import { OAuthNotConfiguredError } from '../errors.js';
import type { IOAuthIntegration } from '../interfaces/IOAuthIntegration.js';

/**
 * YouTube Auth Configuration
 */
export interface YouTubeAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
  accessToken?: string;
  refreshToken?: string;
  /** Absolute token expiry as a Unix ms timestamp (Google's expiry_date). */
  expiryDate?: number;
}

/**
 * Required OAuth scopes for the YouTube integration.
 * Single source of truth — the frontend and OAuthHandler should not specify scopes.
 * `force-ssl` is required to insert live chat messages and update broadcasts.
 */
const YOUTUBE_REQUIRED_SCOPES = [
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/youtube.force-ssl',
];

// Derive the OAuth client + credentials types straight from the runtime `google.auth.OAuth2`
// value so they always reference the same google-auth-library copy `google.youtube()` expects.
// (googleapis ships a nested copy; importing types from 'google-auth-library' picks a different one
// and clashes under exactOptionalPropertyTypes.)
export type YouTubeOAuth2Client = InstanceType<typeof google.auth.OAuth2>;
type YouTubeCredentials = NonNullable<Parameters<YouTubeOAuth2Client['setCredentials']>[0]>;

const YOUTUBE_CALLBACK_PATH = '/callback/youtube';
// Google's loopback flow recommends the literal loopback IP (127.0.0.1) rather than `localhost`,
// which can trigger client-firewall issues. This matches Spotify, and differs from Twitch (which
// requires `localhost`). See the oauth_redirect_host_constraint note.
const YOUTUBE_REDIRECT_URI = `http://127.0.0.1:8080${YOUTUBE_CALLBACK_PATH}`;

/**
 * YouTube Auth Integration
 * Handles Google OAuth 2.0 authorization-code flow, token storage, and token refresh.
 *
 * Responsibilities:
 * - OAuth authorization code flow (loopback redirect)
 * - Token storage (encrypted in database)
 * - Automatic token refresh (YouTubeOAuth2Client refreshes on demand and emits 'tokens')
 * - Providing an authenticated YouTubeOAuth2Client to the YouTube API + Chat integrations
 */
export class YouTubeAuthIntegration extends BaseIntegration implements IOAuthIntegration {
  readonly name = 'youtube-auth';
  readonly version = '1.0.0';

  private config: YouTubeAuthConfig | null = null;
  private oauth2Client: YouTubeOAuth2Client | null = null;

  constructor(
    private eventBus: EventBus,
    logger: Logger,
    private stateRepo: IntegrationStateRepository
  ) {
    super(logger, { component: 'YouTubeAuth' });
  }

  initialize(config: Record<string, unknown>): Promise<void> {
    this.logger.info('Initializing YouTube Auth integration');

    this.config = config as unknown as YouTubeAuthConfig;

    // Validate config
    if (!(this.config.clientId && this.config.clientSecret)) {
      throw new Error('Missing clientId or clientSecret in configuration');
    }

    // Callers (e.g. the setup UI) intentionally omit scopes — this integration
    // is the single source of truth for them.
    if (!this.config.scopes || this.config.scopes.length === 0) {
      this.config.scopes = this.getRequiredScopes();
    }

    this.logger.info('YouTube Auth integration initialized');
    return Promise.resolve();
  }

  start(): Promise<void> {
    if (!this.config) {
      throw new Error('Integration not initialized. Call initialize() first.');
    }

    this.logger.info('Starting YouTube Auth integration');
    this.setStatus(IntegrationStatus.CONNECTING);

    // Check if we have tokens
    if (!this.config.refreshToken) {
      this.logger.warn('No tokens available. User must complete OAuth flow.');
      this.setStatus(IntegrationStatus.DISCONNECTED);
      this.eventBus.emit('integration.auth-required', {
        integration: this.name,
        authUrl: this.getAuthorizationUrl(
          this.config as unknown as Record<string, unknown>,
          randomUUID()
        ),
      });
      return Promise.resolve();
    }

    this.oauth2Client = this.buildClient(this.config);
    this.applyCredentials(this.oauth2Client, this.config);

    // Persist tokens whenever the client refreshes them.
    this.oauth2Client.on('tokens', (tokens) => {
      void this.saveTokens(tokens);
    });

    this.setStatus(IntegrationStatus.CONNECTED);
    this.logger.info('YouTube Auth integration started successfully');

    this.eventBus.emit('youtube.auth.ready', {
      authClient: this.oauth2Client,
    });

    return Promise.resolve();
  }

  stop(): Promise<void> {
    this.logger.info('Stopping YouTube Auth integration');

    this.oauth2Client = null;
    this.setStatus(IntegrationStatus.DISCONNECTED);

    this.logger.info('YouTube Auth integration stopped');
    return Promise.resolve();
  }

  /**
   * Get the authenticated OAuth2 client for use by the API + Chat integrations.
   * The client refreshes its own access token on demand.
   */
  getAuthClient(): YouTubeOAuth2Client | null {
    return this.oauth2Client;
  }

  override get oauth(): IOAuthIntegration {
    return this;
  }

  /**
   * Inspect an error thrown by a YouTube Data API call and report whether it looks like an OAuth
   * failure (expired/revoked refresh token) rather than an ordinary API error. The googleapis
   * client refreshes access tokens transparently inside each request, so a dead refresh token
   * only ever surfaces this way — there's no separate refresh-failure event to listen for.
   */
  isAuthError(error: unknown): boolean {
    const status = (error as { code?: number; response?: { status?: number } } | null)?.code;
    const responseStatus = (error as { response?: { status?: number } } | null)?.response?.status;
    const message = error instanceof Error ? error.message : String(error);
    return status === 401 || responseStatus === 401 || message.includes('invalid_grant');
  }

  /**
   * Flag this integration as needing the user to redo the OAuth flow. Called by
   * YouTubeApiIntegration when isAuthError() identifies a refresh failure.
   */
  markAuthRequired(message = 'Token refresh failed — re-authorization required'): void {
    this.setStatus(IntegrationStatus.NEEDS_REAUTH, message);
  }

  /**
   * OAuth scopes this integration requires (IOAuthIntegration)
   */
  getRequiredScopes(): string[] {
    return YOUTUBE_REQUIRED_SCOPES;
  }

  /**
   * Build a config from environment variables, for first-time setup before
   * any config has been saved to the database (IOAuthIntegration).
   */
  getEnvConfig(): Record<string, unknown> {
    const config: YouTubeAuthConfig = {
      clientId: process.env.YOUTUBE_CLIENT_ID || '',
      clientSecret: process.env.YOUTUBE_CLIENT_SECRET || '',
      redirectUri: YOUTUBE_REDIRECT_URI,
      scopes: YOUTUBE_REQUIRED_SCOPES,
    };

    if (!(config.clientId && config.clientSecret)) {
      throw new OAuthNotConfiguredError(
        'YouTube credentials not configured. Please configure Client ID and Client Secret.'
      );
    }

    return config as unknown as Record<string, unknown>;
  }

  /**
   * HTTP path this integration's OAuth redirect URI points at (IOAuthIntegration)
   */
  getCallbackPath(): string {
    return YOUTUBE_CALLBACK_PATH;
  }

  /**
   * Generate OAuth authorization URL. `access_type: 'offline'` + `prompt: 'consent'` ensures a
   * refresh token is issued.
   */
  getAuthorizationUrl(config: Record<string, unknown>, state: string): string {
    const typed = config as unknown as YouTubeAuthConfig;
    const client = this.buildClient(typed);
    return client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: typed.scopes,
      state,
    });
  }

  /**
   * Exchange authorization code for tokens
   */
  async exchangeCode(code: string): Promise<void> {
    if (!this.config) {
      throw new Error('Integration not initialized');
    }

    this.logger.info('Exchanging authorization code for tokens');

    const client = this.buildClient(this.config);
    const { tokens } = await client.getToken(code);

    await this.saveTokens(tokens);

    this.logger.info('Successfully exchanged code for tokens');
  }

  private buildClient(config: YouTubeAuthConfig): YouTubeOAuth2Client {
    return new google.auth.OAuth2(config.clientId, config.clientSecret, config.redirectUri);
  }

  private applyCredentials(client: YouTubeOAuth2Client, config: YouTubeAuthConfig): void {
    const credentials: YouTubeCredentials = {};
    if (config.accessToken !== undefined) {
      credentials.access_token = config.accessToken;
    }
    if (config.refreshToken !== undefined) {
      credentials.refresh_token = config.refreshToken;
    }
    if (config.expiryDate !== undefined) {
      credentials.expiry_date = config.expiryDate;
    }
    client.setCredentials(credentials);
  }

  /**
   * Save tokens to database. Google omits refresh_token on refreshes, so we preserve the
   * previously stored one when a new one isn't returned.
   */
  private async saveTokens(tokens: YouTubeCredentials): Promise<void> {
    if (!this.config) {
      throw new Error('Integration not initialized');
    }

    const updatedConfig: YouTubeAuthConfig = { ...this.config };

    if (tokens.access_token) {
      updatedConfig.accessToken = tokens.access_token;
    }
    if (tokens.refresh_token) {
      updatedConfig.refreshToken = tokens.refresh_token;
    }
    if (tokens.expiry_date !== undefined && tokens.expiry_date !== null) {
      updatedConfig.expiryDate = tokens.expiry_date;
    }

    this.config = updatedConfig;

    if (this.oauth2Client) {
      this.applyCredentials(this.oauth2Client, updatedConfig);
    }

    await this.stateRepo.upsert(
      this.name,
      updatedConfig as unknown as Record<string, unknown>,
      true
    );
  }
}
