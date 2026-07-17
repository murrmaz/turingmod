import { SpotifyApi } from '@spotify/web-api-ts-sdk';
import type { PlaybackState } from '@spotify/web-api-ts-sdk';
import { IntegrationStatus } from '@turingmod/shared';
import type { EventBus } from '../../core/EventBus.js';
import type { Logger } from '../../utils/Logger.js';
import { BaseIntegration } from '../BaseIntegration.js';
import type { SpotifyAuthIntegration, SpotifyTokenData } from './SpotifyAuthIntegration.js';

/**
 * Spotify API Configuration
 */
export type SpotifyApiConfig = Record<string, unknown>;

/**
 * Spotify API Integration
 * Handles Spotify Web API calls via the official SDK
 *
 * Responsibilities:
 * - Creating and managing the Spotify SDK instance
 * - Exposing API methods to commands and other integrations
 * - Recreating SDK when tokens are refreshed
 *
 * Depends on: SpotifyAuthIntegration
 */
export class SpotifyApiIntegration extends BaseIntegration {
  readonly name = 'spotify-api';
  readonly version = '1.0.0';

  private sdk: SpotifyApi | null = null;
  private tokenRefreshUnsubscribe: (() => void) | null = null;

  constructor(
    private eventBus: EventBus,
    logger: Logger,
    private authIntegration: SpotifyAuthIntegration
  ) {
    super(logger, { component: 'SpotifyAPI' });
  }

  /**
   * Get integration dependencies
   */
  getDependencies(): string[] {
    return ['spotify-auth'];
  }

  initialize(_config: Record<string, unknown>): Promise<void> {
    this.logger.info('Spotify API integration initialized (no config needed)');
    return Promise.resolve();
  }

  start(): Promise<void> {
    this.logger.info('Starting Spotify API integration');
    this.setStatus(IntegrationStatus.CONNECTING);

    try {
      const tokenData = this.authIntegration.getTokenData();
      const clientId = this.authIntegration.getClientId();

      if (!(tokenData && clientId)) {
        throw new Error('SpotifyAuthIntegration must be started before SpotifyApiIntegration');
      }

      // Create SDK instance
      this.sdk = this.createSdk(clientId, tokenData);

      // Listen for token refreshes to recreate SDK
      this.tokenRefreshUnsubscribe = this.eventBus.on(
        'spotify.auth.token-refreshed',
        (data: { tokenData: SpotifyTokenData }) => {
          this.logger.info('Recreating Spotify SDK with refreshed tokens');
          if (clientId) {
            this.sdk = this.createSdk(clientId, data.tokenData);
          }
        }
      );

      this.setStatus(IntegrationStatus.CONNECTED);
      this.logger.info('Spotify API integration started successfully');

      // Emit event that API is ready
      this.eventBus.emit('spotify.api.ready', {
        sdk: this.sdk,
      });

      return Promise.resolve();
    } catch (error) {
      this.logger.error('Failed to start Spotify API integration', error);
      this.setStatus(
        IntegrationStatus.ERROR,
        error instanceof Error ? error.message : 'Unknown error'
      );
      throw error;
    }
  }

  stop(): Promise<void> {
    this.logger.info('Stopping Spotify API integration');

    // Unsubscribe from token refresh events
    if (this.tokenRefreshUnsubscribe) {
      this.tokenRefreshUnsubscribe();
      this.tokenRefreshUnsubscribe = null;
    }

    this.sdk = null;
    this.setStatus(IntegrationStatus.DISCONNECTED);

    this.logger.info('Spotify API integration stopped');
    return Promise.resolve();
  }

  /**
   * Get the SDK instance for direct use by commands
   */
  getSdk(): SpotifyApi | null {
    return this.sdk;
  }

  /**
   * Get currently playing track
   */
  async getCurrentlyPlaying(): Promise<PlaybackState | null> {
    return await this.withTokenRefresh(() => {
      if (!this.sdk) {
        throw new Error('Spotify SDK not initialized');
      }
      return this.sdk.player.getCurrentlyPlayingTrack();
    });
  }

  /**
   * Execute an API call with automatic token refresh on 401.
   * If the call fails with a 401, refreshes the token, recreates the SDK, and retries once.
   */
  private async withTokenRefresh<T>(apiCall: () => Promise<T>): Promise<T> {
    try {
      return await apiCall();
    } catch (error) {
      if (!this.isExpiredTokenError(error)) {
        throw error;
      }

      this.logger.info('Access token expired, refreshing and retrying...');
      await this.authIntegration.refreshAccessToken();

      // Recreate SDK with the new tokens
      const tokenData = this.authIntegration.getTokenData();
      const clientId = this.authIntegration.getClientId();
      if (!(tokenData && clientId)) {
        throw new Error('Failed to obtain refreshed tokens');
      }
      this.sdk = this.createSdk(clientId, tokenData);

      // Retry the call once
      return await apiCall();
    }
  }

  /**
   * Check whether an error indicates an expired/invalid access token (HTTP 401).
   */
  private isExpiredTokenError(error: unknown): boolean {
    if (error instanceof Error && error.message.includes('401')) {
      return true;
    }
    // The Spotify SDK may throw an object with a status property
    if (typeof error === 'object' && error !== null && 'status' in error) {
      return (error as { status: number }).status === 401;
    }
    return false;
  }

  /**
   * Create a new Spotify SDK instance with the given tokens
   */
  private createSdk(clientId: string, tokenData: SpotifyTokenData): SpotifyApi {
    return SpotifyApi.withAccessToken(clientId, {
      access_token: tokenData.accessToken,
      token_type: 'Bearer',
      expires_in: tokenData.expiresIn,
      refresh_token: tokenData.refreshToken,
    });
  }
}
