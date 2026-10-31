import { type IntegrationGroup, IntegrationName, IntegrationStatus } from '@turingmod/shared';
import { singleton } from 'tsyringe';
import { z } from 'zod';
import { IntegrationStateRepository } from '../../../database/repositories/IntegrationStateRepository.js';
import { TuringModConfig } from '../../../utils/Config.js';
import { Logger } from '../../../utils/Logger.js';
import { parseScopes } from '../../OAuthIntegration.js';
import {
  type StandardOAuthConfig,
  StandardOAuthConfigSchema,
  StandardOAuthIntegration,
} from '../../StandardOAuthIntegration.js';
import { SPOTIFY_GROUP } from './spotifyGroup.js';

/**
 * Required OAuth scopes for the Spotify integration.
 * Single source of truth: nothing else names them, the authorization URL included.
 */
const SPOTIFY_REQUIRED_SCOPES = [
  'user-read-currently-playing',
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-recently-played',
];

/** Refresh this long before the access token expires, so a call never carries one that's about to. */
const REFRESH_MARGIN_MS = 60 * 1000;

/** A response from Spotify's token endpoint, for both a code exchange and a refresh. */
const SpotifyTokenResponseSchema = z.object({
  access_token: z.string().min(1),
  scope: z.string(),
  expires_in: z.number().positive(),
  /** Always sent for a code exchange; a refresh may omit it, keeping the old one valid. */
  refresh_token: z.string().min(1).exactOptional(),
});

type SpotifyTokenResponse = z.infer<typeof SpotifyTokenResponseSchema>;

/**
 * Spotify's OAuth grant: the authorization code flow, the stored tokens, and
 * keeping the access token valid.
 *
 * Owns the tokens outright. getAccessToken() hands out one that is good for at
 * least another minute, refreshing first when it isn't, and nothing else reads
 * or refreshes them — Spotify's SDK is never given a refresh token, since its
 * own refresh omits the client secret this confidential-client grant requires.
 */
@singleton()
export class SpotifyAuthIntegration extends StandardOAuthIntegration<
  StandardOAuthConfig,
  SpotifyTokenResponse
> {
  readonly name = IntegrationName.SPOTIFY_AUTH;

  protected readonly requiredScopes = SPOTIFY_REQUIRED_SCOPES;
  protected readonly callbackPath = '/callback/spotify';
  /** Spotify accepts plain-HTTP redirects only to the literal loopback IP, not `localhost`. */
  protected readonly redirectHost = '127.0.0.1';
  protected readonly configSchema = StandardOAuthConfigSchema;
  protected readonly authorizeUrl = 'https://accounts.spotify.com/authorize';
  protected readonly tokenUrl = 'https://accounts.spotify.com/api/token';
  protected readonly clientAuthentication = 'basic';
  protected readonly tokenResponseSchema = SpotifyTokenResponseSchema;

  /** The refresh in flight, shared by every caller that needs one meanwhile. */
  private refreshing: Promise<string> | null = null;

  constructor(
    logger: Logger,
    stateRepo: IntegrationStateRepository,
    serverConfig: TuringModConfig
  ) {
    super(logger, 'SpotifyAuth', stateRepo, serverConfig);
  }

  /** Nothing to build: SpotifyApiIntegration reads the tokens on access. */
  protected connect(): Promise<void> {
    return Promise.resolve();
  }

  override getGroup(): IntegrationGroup {
    return SPOTIFY_GROUP;
  }

  /**
   * An access token valid for at least another minute, refreshed first if
   * needed. Throws while Spotify isn't connected, or if the refresh fails.
   */
  async getAccessToken(): Promise<string> {
    if (this.getStatus() !== IntegrationStatus.CONNECTED) {
      throw new Error('Spotify is not connected');
    }
    const accessToken = this.config?.accessToken;
    if (!accessToken || this.expiresSoon()) {
      return await this.refreshAccessToken();
    }
    return accessToken;
  }

  /**
   * Refresh the access token now, returning the new one. getAccessToken()
   * calls this before expiry; SpotifyApiIntegration calls it when Spotify
   * rejects a token that hadn't expired yet. Concurrent callers share one
   * refresh: Spotify may rotate the refresh token, so a second request made
   * with the old one could fail.
   */
  refreshAccessToken(): Promise<string> {
    this.refreshing ??= this.refresh().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  /** True when the stored token expires within the margin, or its expiry is unknown. */
  private expiresSoon(): boolean {
    const { expiresIn, obtainmentTimestamp } = this.config ?? {};
    if (expiresIn === undefined || obtainmentTimestamp === undefined) {
      return true;
    }
    return obtainmentTimestamp + expiresIn * 1000 - REFRESH_MARGIN_MS <= Date.now();
  }

  private async refresh(): Promise<string> {
    const refreshToken = this.config?.refreshToken;
    if (!refreshToken) {
      throw new Error('No refresh token available');
    }

    this.logger.info('Refreshing access token');

    const response = await this.requestToken({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });

    if (!response.ok) {
      const error = await response.text();
      this.logger.error('Token refresh failed', error, { status: response.status });
      // 400 (invalid_grant) and 401 mean the grant itself is gone; anything
      // else (a 5xx, a 429) is Spotify having a bad moment, and the next call
      // can try again.
      if (response.status === 400 || response.status === 401) {
        this.setStatus(
          IntegrationStatus.NEEDS_REAUTH,
          'Token refresh failed — re-authorization required'
        );
      }
      throw new Error(`Token refresh failed: ${error}`);
    }

    const data = await this.parseTokenResponse(SpotifyTokenResponseSchema, response);
    this.saveTokens(this.toConfigPatch(data));

    this.logger.info('Access token refreshed');

    this.reportTokenRefreshed(Date.now() + data.expires_in * 1000);
    return data.access_token;
  }

  /** A refresh without a new refresh token keeps the old one. */
  protected toConfigPatch(data: SpotifyTokenResponse): Partial<StandardOAuthConfig> {
    const patch: Partial<StandardOAuthConfig> = {
      accessToken: data.access_token,
      expiresIn: data.expires_in,
      obtainmentTimestamp: Date.now(),
    };
    if (data.refresh_token) {
      patch.refreshToken = data.refresh_token;
    }
    const grantedScopes = parseScopes(data.scope);
    if (grantedScopes) {
      patch.grantedScopes = grantedScopes;
    }
    return patch;
  }
}
