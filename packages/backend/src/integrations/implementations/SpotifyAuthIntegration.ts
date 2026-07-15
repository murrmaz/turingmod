import { EventEmitter } from 'node:events';
import { IntegrationStatus } from '@turingmod/shared';
import type { EventBus } from '../../core/EventBus.js';
import type { IntegrationStateRepository } from '../../database/repositories/IntegrationStateRepository.js';
import type { Logger } from '../../utils/Logger.js';
import type { IIntegration } from '../interfaces/IIntegration.js';

/**
 * Spotify Auth Configuration
 */
export interface SpotifyAuthConfig {
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
export class SpotifyAuthIntegration implements IIntegration {
  readonly name = 'spotify-auth';
  readonly version = '1.0.0';

  private status: IntegrationStatus = IntegrationStatus.DISCONNECTED;
  private errorMessage: string | undefined;
  private config: SpotifyAuthConfig | null = null;
  private events = new EventEmitter();
  private logger: Logger;

  constructor(
    private eventBus: EventBus,
    logger: Logger,
    private stateRepo: IntegrationStateRepository
  ) {
    this.logger = logger.child({ integration: 'SpotifyAuth' });
  }

  initialize(config: Record<string, unknown>): Promise<void> {
    this.logger.info('Initializing Spotify Auth integration');

    this.config = config as unknown as SpotifyAuthConfig;

    // Validate config
    if (!(this.config.clientId && this.config.clientSecret)) {
      throw new Error('Missing clientId or clientSecret in configuration');
    }

    this.logger.info('Spotify Auth integration initialized');
    return Promise.resolve();
  }

  start(): Promise<void> {
    if (!this.config) {
      throw new Error('Integration not initialized. Call initialize() first.');
    }

    this.logger.info('Starting Spotify Auth integration');
    this.setStatus(IntegrationStatus.CONNECTING);

    // Check if we have tokens
    if (!this.config.accessToken) {
      this.logger.warn('No tokens available. User must complete OAuth flow.');
      this.setStatus(IntegrationStatus.DISCONNECTED);
      this.eventBus.emit('integration.auth-required', {
        integration: this.name,
        authUrl: this.getAuthorizationUrl(this.config),
      });
      return Promise.resolve();
    }

    this.setStatus(IntegrationStatus.CONNECTED);
    this.logger.info('Spotify Auth integration started successfully');

    // Emit event that auth is ready
    this.eventBus.emit('spotify.auth.ready', {
      tokenData: this.getTokenData(),
    });

    return Promise.resolve();
  }

  stop(): Promise<void> {
    this.logger.info('Stopping Spotify Auth integration');

    this.setStatus(IntegrationStatus.DISCONNECTED);

    this.logger.info('Spotify Auth integration stopped');
    return Promise.resolve();
  }

  getStatus(): IntegrationStatus {
    return this.status;
  }

  getErrorMessage(): string | undefined {
    return this.errorMessage;
  }

  on(event: string, handler: (...args: unknown[]) => void): void {
    this.events.on(event, handler);
  }

  off(event: string, handler: (...args: unknown[]) => void): void {
    this.events.off(event, handler);
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

  /**
   * Generate OAuth authorization URL
   */
  getAuthorizationUrl(config: SpotifyAuthConfig): string {
    const params = new URLSearchParams({
      client_id: config.clientId,
      response_type: 'code',
      redirect_uri: config.redirectUri,
      scope: config.scopes.join(' '),
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
        redirect_uri: this.config.redirectUri,
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
      this.logger.error('Token refresh failed', { error });
      this.setStatus(
        IntegrationStatus.ERROR,
        'Token refresh failed \u2014 re-authorization required'
      );
      if (this.config) {
        this.eventBus.emit('integration.auth-required', {
          integration: this.name,
          authUrl: this.getAuthorizationUrl(this.config),
        });
      }
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

    // Emit event for other integrations (e.g., SpotifyApiIntegration)
    this.eventBus.emit('spotify.auth.token-refreshed', {
      tokenData: this.getTokenData(),
    });
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

    const updatedConfig: SpotifyAuthConfig = {
      ...this.config,
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      expiresIn: token.expiresIn,
      obtainmentTimestamp: token.obtainmentTimestamp,
    };

    // Update local config
    this.config = updatedConfig;

    // Save to database
    await this.stateRepo.upsert(
      this.name,
      updatedConfig as unknown as Record<string, unknown>,
      true
    );
  }

  /**
   * Set integration status and emit event
   */
  private setStatus(status: IntegrationStatus, errorMessage?: string): void {
    this.status = status;
    this.errorMessage = status === IntegrationStatus.ERROR ? errorMessage : undefined;
    this.events.emit('status', status);
  }
}
