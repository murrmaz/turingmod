import type { PlaybackState } from '@spotify/web-api-ts-sdk';
import { SpotifyApi } from '@spotify/web-api-ts-sdk';
import { IntegrationGroup, IntegrationStatus } from '@turingmod/shared';
import { injectable, singleton } from 'tsyringe';
import { Logger } from '../../../utils/Logger.js';
import { BaseIntegration } from '../../BaseIntegration.js';
import { DependencyFailurePolicy, type IIntegration } from '../../interfaces/IIntegration.js';
import { SpotifyAuthIntegration, type SpotifyTokenData } from './SpotifyAuthIntegration.js';

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
@injectable()
@singleton()
export class SpotifyApiIntegration extends BaseIntegration {
  readonly name = 'spotify-api';
  readonly version = '1.0.0';

  private sdk: SpotifyApi | null = null;
  /** The credentials `sdk` was built on, to detect them being replaced. */
  private sdkCredentials: { clientId: string; accessToken: string } | null = null;

  constructor(
    logger: Logger,
    private authIntegration: SpotifyAuthIntegration
  ) {
    super(logger, { component: 'SpotifyAPI' });
  }

  /**
   * Get integration dependencies
   */
  getDependencies(): IIntegration[] {
    return [this.authIntegration];
  }

  /**
   * Resolves its SDK from the auth integration's current credentials on
   * access, so a Spotify auth failure blocks this integration rather than
   * stopping it.
   */
  override get dependencyFailurePolicy(): DependencyFailurePolicy {
    return DependencyFailurePolicy.BLOCK;
  }

  getGroup(): IntegrationGroup {
    return IntegrationGroup.SPOTIFY;
  }

  initialize(_config: Record<string, unknown>): Promise<void> {
    this.logger.info('Spotify API integration initialized (no config needed)');
    return Promise.resolve();
  }

  start(): Promise<void> {
    this.logger.info('Starting Spotify API integration');
    this.setStatus(IntegrationStatus.CONNECTING);

    try {
      const sdk = this.resolveSdk();

      if (!sdk) {
        throw new Error('SpotifyAuthIntegration must be started before SpotifyApiIntegration');
      }

      this.setStatus(IntegrationStatus.CONNECTED);
      this.logger.info('Spotify API integration started successfully');

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

    this.sdk = null;
    this.sdkCredentials = null;
    this.setStatus(IntegrationStatus.DISCONNECTED);

    this.logger.info('Spotify API integration stopped');
    return Promise.resolve();
  }

  /**
   * Get the SDK instance for direct use by commands
   */
  getSdk(): SpotifyApi | null {
    return this.resolveSdk();
  }

  /**
   * Return an SDK bound to the auth integration's *current* credentials,
   * rebuilding it when they've changed.
   *
   * This replaces a `spotify.auth.token-refreshed` subscription that rebuilt
   * the SDK on refresh: that covered a refresh but not the auth integration
   * restarting with different credentials, and it rebuilt against a clientId
   * captured in a closure at start() time. Resolving on access covers both
   * and needs no subscription to keep in sync.
   */
  private resolveSdk(): SpotifyApi | null {
    // Credentials that are present but no longer refreshable look identical
    // from here, so gate on the dependency's status as well as the values.
    const connected = this.authIntegration.getStatus() === IntegrationStatus.CONNECTED;
    const tokenData = connected ? this.authIntegration.getTokenData() : null;
    const clientId = connected ? this.authIntegration.getClientId() : null;

    if (!(tokenData && clientId)) {
      this.sdk = null;
      this.sdkCredentials = null;
      return null;
    }

    // getTokenData() builds a fresh object per call, so compare the access
    // token itself rather than object identity.
    if (
      this.sdk &&
      this.sdkCredentials?.clientId === clientId &&
      this.sdkCredentials.accessToken === tokenData.accessToken
    ) {
      return this.sdk;
    }

    if (this.sdkCredentials) {
      this.logger.info('Spotify credentials changed; rebuilding SDK');
    }

    this.sdkCredentials = { clientId, accessToken: tokenData.accessToken };
    this.sdk = this.createSdk(clientId, tokenData);
    return this.sdk;
  }

  /**
   * Get currently playing track
   */
  async getCurrentlyPlaying(): Promise<PlaybackState | null> {
    return await this.withTokenRefresh(() => {
      const sdk = this.resolveSdk();
      if (!sdk) {
        throw new Error('Spotify SDK not initialized');
      }
      return sdk.player.getCurrentlyPlayingTrack();
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

      // The retry resolves the SDK again, which picks up the new tokens.
      if (!this.resolveSdk()) {
        throw new Error('Failed to obtain refreshed tokens');
      }

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
