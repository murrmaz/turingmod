import { IntegrationGroup, IntegrationStatus } from '@turingmod/shared';
import { injectable, singleton } from 'tsyringe';
import { IntegrationStateRepository } from '../../../database/repositories/IntegrationStateRepository.js';
import { TuringModConfig } from '../../../utils/Config.js';
import { Logger } from '../../../utils/Logger.js';
import { type OAuthConfigBase, OAuthIntegration, parseScopes } from '../../OAuthIntegration.js';

/**
 * Spotify Auth Configuration
 */
export interface SpotifyAuthConfig extends OAuthConfigBase {
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

/**
 * Token data exposed to SpotifyApiIntegration
 */
export interface SpotifyTokenData {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  obtainmentTimestamp: number;
}

/** A response from Spotify's token endpoint, for both a code exchange and a refresh. */
interface SpotifyTokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
  expires_in: number;
  /** Always sent for a code exchange; a refresh may omit it, keeping the old one valid. */
  refresh_token?: string;
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
export class SpotifyAuthIntegration extends OAuthIntegration<SpotifyAuthConfig> {
  readonly name = 'spotify-auth';

  protected readonly requiredScopes = SPOTIFY_REQUIRED_SCOPES;
  protected readonly callbackPath = '/callback/spotify';
  /** Spotify accepts plain-HTTP redirects only to the literal loopback IP, not `localhost`. */
  protected readonly redirectHost = '127.0.0.1';

  constructor(
    logger: Logger,
    stateRepo: IntegrationStateRepository,
    serverConfig: TuringModConfig
  ) {
    super(logger, 'SpotifyAuth', stateRepo, serverConfig);
  }

  protected hasTokens(config: SpotifyAuthConfig): boolean {
    return Boolean(config.accessToken);
  }

  /** Nothing to build: SpotifyApiIntegration reads the tokens on access. */
  protected connect(): Promise<void> {
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

  getAuthorizationUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.requireConfig().clientId,
      response_type: 'code',
      redirect_uri: this.getRedirectUri(),
      scope: SPOTIFY_REQUIRED_SCOPES.join(' '),
      state,
    });

    return `https://accounts.spotify.com/authorize?${params.toString()}`;
  }

  async exchangeCode(code: string): Promise<void> {
    this.logger.info('Exchanging authorization code for tokens');

    const response = await this.requestToken({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.getRedirectUri(),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to exchange code: ${error}`);
    }

    this.saveTokens(toConfigPatch((await response.json()) as SpotifyTokenResponse));

    this.logger.info('Successfully exchanged code for tokens');
  }

  /**
   * Refresh the access token using the stored refresh token.
   * Called by SpotifyApiIntegration when an API call is rejected (401).
   */
  async refreshAccessToken(): Promise<void> {
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
      this.logger.error('Token refresh failed', error);
      this.setStatus(
        IntegrationStatus.NEEDS_REAUTH,
        'Token refresh failed — re-authorization required'
      );
      throw new Error(`Token refresh failed: ${error}`);
    }

    const data = (await response.json()) as SpotifyTokenResponse;
    this.saveTokens(toConfigPatch(data));

    this.logger.info('Access token refreshed');

    this.reportTokenRefreshed(Date.now() + data.expires_in * 1000);
  }

  /** POST to Spotify's token endpoint, authenticating with the client credentials. */
  private requestToken(params: Record<string, string>): Promise<Response> {
    const { clientId, clientSecret } = this.requireConfig();
    return fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        // biome-ignore lint/style/useNamingConvention: HTTP header
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      },
      body: new URLSearchParams(params),
    });
  }
}

/** The stored-config fields for a token response; a refresh without a new refresh token keeps the old one. */
function toConfigPatch(data: SpotifyTokenResponse): Partial<SpotifyAuthConfig> {
  const patch: Partial<SpotifyAuthConfig> = {
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
