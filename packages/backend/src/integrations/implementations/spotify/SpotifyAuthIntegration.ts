import { IntegrationGroup, IntegrationStatus } from '@turingmod/shared';
import { injectable, singleton } from 'tsyringe';
import { IntegrationStateRepository } from '../../../database/repositories/IntegrationStateRepository.js';
import { TuringModConfig } from '../../../utils/Config.js';
import { Logger } from '../../../utils/Logger.js';
import { BaseIntegration } from '../../BaseIntegration.js';
import type { IOAuthIntegration } from '../../interfaces/IOAuthIntegration.js';
import {
  oauthRedirectUri,
  persistOAuthTokens,
  validateOAuthConfig,
} from '../../oauthConfigHelpers.js';

/**
 * Spotify Auth Configuration
 */
export interface SpotifyAuthConfig {
  clientId: string;
  clientSecret: string;
  scopes: string[];
  accessToken?: string;
  refreshToken?: string;
  expiresIn?: number;
  obtainmentTimestamp?: number;
}

/**
 * Required OAuth scopes for the Spotify integration.
 * Single source of truth — the frontend and OAuthHandler should not specify scopes.
 */
const SPOTIFY_REQUIRED_SCOPES = [
  'user-read-currently-playing',
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-recently-played',
];

const SPOTIFY_CALLBACK_PATH = '/callback/spotify';
/** Spotify accepts plain-HTTP redirects only to the literal loopback IP, not `localhost`. */
const SPOTIFY_REDIRECT_HOST = '127.0.0.1';

/**
 * Token data exposed to SpotifyApiIntegration
 */
export interface SpotifyTokenData {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  obtainmentTimestamp: number;
}

/**
 * Spotify Auth Integration
 * Handles OAuth flow, token storage, and token refresh
 *
 * Responsibilities:
 * - OAuth authorization code flow
 * - Token storage (encrypted in database)
 * - On-demand token refresh (called by SpotifyApiIntegration on 401)
 * - Providing valid tokens to SpotifyApiIntegration
 */
@injectable()
@singleton()
export class SpotifyAuthIntegration extends BaseIntegration implements IOAuthIntegration {
  readonly name = 'spotify-auth';
  readonly version = '1.0.0';

  private config: SpotifyAuthConfig | null = null;

  constructor(
    logger: Logger,
    private stateRepo: IntegrationStateRepository,
    private serverConfig: TuringModConfig
  ) {
    super(logger, { component: 'SpotifyAuth' });
  }

  initialize(config: Record<string, unknown>): Promise<void> {
    this.logger.info('Initializing Spotify Auth integration');

    this.config = config as unknown as SpotifyAuthConfig;
    validateOAuthConfig(this.config, this.getRequiredScopes());

    this.logger.info('Spotify Auth integration initialized');
    return Promise.resolve();
  }

  start(): Promise<void> {
    if (!this.config) {
      throw new Error('Integration not initialized. Call initialize() first.');
    }

    this.logger.debug('Starting Spotify Auth integration');
    this.setStatus(IntegrationStatus.CONNECTING);

    // Check if we have tokens
    if (!this.config.accessToken) {
      this.logger.warn('No tokens available. User must complete OAuth flow.');
      this.setStatus(IntegrationStatus.DISCONNECTED);
      return Promise.resolve();
    }

    this.setStatus(IntegrationStatus.CONNECTED);
    this.logger.debug('Spotify Auth integration started successfully');

    return Promise.resolve();
  }

  stop(): Promise<void> {
    this.logger.debug('Stopping Spotify Auth integration');

    this.setStatus(IntegrationStatus.DISCONNECTED);

    this.logger.debug('Spotify Auth integration stopped');
    return Promise.resolve();
  }

  getGroup(): IntegrationGroup {
    return IntegrationGroup.SPOTIFY;
  }

  /**
   * Get token data for use by SpotifyApiIntegration
   */
  getTokenData(): SpotifyTokenData | null {
    if (!(this.config?.accessToken && this.config.refreshToken)) {
      return null;
    }

    return {
      accessToken: this.config.accessToken,
      refreshToken: this.config.refreshToken,
      expiresIn: this.config.expiresIn ?? 3600,
      obtainmentTimestamp: this.config.obtainmentTimestamp ?? Date.now(),
    };
  }

  /**
   * Get the client ID (needed by SpotifyApiIntegration for SDK initialization)
   */
  getClientId(): string | null {
    return this.config?.clientId ?? null;
  }

  override get oauth(): IOAuthIntegration {
    return this;
  }

  /**
   * OAuth scopes this integration requires (IOAuthIntegration)
   */
  getRequiredScopes(): string[] {
    return SPOTIFY_REQUIRED_SCOPES;
  }

  /**
   * Whether client credentials have been set up (IOAuthIntegration)
   */
  isConfigured(): boolean {
    return Boolean(this.config?.clientId && this.config.clientSecret);
  }

  /**
   * HTTP path this integration's OAuth redirect URI points at (IOAuthIntegration)
   */
  getCallbackPath(): string {
    return SPOTIFY_CALLBACK_PATH;
  }

  /**
   * OAuth redirect URI (IOAuthIntegration)
   */
  getRedirectUri(): string {
    return oauthRedirectUri(
      SPOTIFY_REDIRECT_HOST,
      this.serverConfig.serverPort,
      SPOTIFY_CALLBACK_PATH
    );
  }

  /**
   * Generate OAuth authorization URL
   */
  getAuthorizationUrl(state: string): string {
    if (!this.config) {
      throw new Error('Spotify client credentials are not configured');
    }
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      response_type: 'code',
      redirect_uri: this.getRedirectUri(),
      scope: SPOTIFY_REQUIRED_SCOPES.join(' '),
      state,
    });

    return `https://accounts.spotify.com/authorize?${params.toString()}`;
  }

  /**
   * Exchange authorization code for tokens
   */
  async exchangeCode(code: string): Promise<void> {
    if (!this.config) {
      throw new Error('Integration not initialized');
    }

    this.logger.info('Exchanging authorization code for tokens');

    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        // biome-ignore lint/style/useNamingConvention: HTTP header
        Authorization: `Basic ${Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: this.getRedirectUri(),
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to exchange code: ${error}`);
    }

    const data = (await response.json()) as {
      access_token: string;
      token_type: string;
      scope: string;
      expires_in: number;
      refresh_token: string;
    };

    await this.saveTokens({
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      obtainmentTimestamp: Date.now(),
    });

    this.logger.info('Successfully exchanged code for tokens');
  }

  /**
   * Refresh the access token using the stored refresh token.
   * Called by SpotifyApiIntegration when an API call is rejected (401).
   */
  async refreshAccessToken(): Promise<void> {
    if (!this.config?.refreshToken) {
      throw new Error('No refresh token available');
    }

    this.logger.info('Refreshing access token');

    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        // biome-ignore lint/style/useNamingConvention: HTTP header
        Authorization: `Basic ${Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: this.config.refreshToken,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      this.logger.error('Token refresh failed', error);
      this.setStatus(
        IntegrationStatus.NEEDS_REAUTH,
        'Token refresh failed \u2014 re-authorization required'
      );
      throw new Error(`Token refresh failed: ${error}`);
    }

    const data = (await response.json()) as {
      access_token: string;
      token_type: string;
      scope: string;
      expires_in: number;
      refresh_token?: string;
    };

    await this.saveTokens({
      accessToken: data.access_token,
      // Spotify may or may not return a new refresh token
      refreshToken: data.refresh_token ?? this.config.refreshToken,
      expiresIn: data.expires_in,
      obtainmentTimestamp: Date.now(),
    });

    this.logger.info('Access token refreshed');

    this.reportTokenRefreshed(Date.now() + data.expires_in * 1000);
  }

  /**
   * Save tokens to database
   */
  private async saveTokens(token: {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
    obtainmentTimestamp: number;
  }): Promise<void> {
    if (!this.config) {
      throw new Error('Integration not initialized');
    }

    this.config = await persistOAuthTokens(this.stateRepo, this.name, this.config, token);
  }
}
