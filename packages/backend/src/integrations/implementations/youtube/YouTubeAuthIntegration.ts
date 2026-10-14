import { IntegrationGroup, IntegrationStatus, messageOf } from '@turingmod/shared';
import { google } from 'googleapis';
import { injectable, singleton } from 'tsyringe';
import { z } from 'zod';
import { IntegrationStateRepository } from '../../../database/repositories/IntegrationStateRepository.js';
import { TuringModConfig } from '../../../utils/Config.js';
import { Logger } from '../../../utils/Logger.js';
import { OAuthConfigBaseSchema, OAuthIntegration, parseScopes } from '../../OAuthIntegration.js';

/**
 * YouTube Auth Configuration
 */
export const YouTubeAuthConfigSchema = OAuthConfigBaseSchema.extend({
  accessToken: z.string().exactOptional(),
  refreshToken: z.string().exactOptional(),
  /** Absolute token expiry as a Unix ms timestamp (Google's expiry_date). */
  expiryDate: z.number().exactOptional(),
});

export type YouTubeAuthConfig = z.infer<typeof YouTubeAuthConfigSchema>;

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
@injectable()
@singleton()
export class YouTubeAuthIntegration extends OAuthIntegration<YouTubeAuthConfig> {
  readonly name = 'youtube-auth';

  protected readonly requiredScopes = YOUTUBE_REQUIRED_SCOPES;
  protected readonly callbackPath = '/callback/youtube';
  // Google's loopback flow recommends the literal loopback IP (127.0.0.1) rather than `localhost`,
  // which can trigger client-firewall issues. This matches Spotify, and differs from Twitch (which
  // requires `localhost`).
  protected readonly redirectHost = '127.0.0.1';
  protected readonly configSchema = YouTubeAuthConfigSchema;

  private oauth2Client: YouTubeOAuth2Client | null = null;

  constructor(
    logger: Logger,
    stateRepo: IntegrationStateRepository,
    serverConfig: TuringModConfig
  ) {
    super(logger, 'YouTubeAuth', stateRepo, serverConfig);
  }

  /** The client refreshes access tokens itself, so a refresh token is what matters. */
  protected hasTokens(config: YouTubeAuthConfig): boolean {
    return Boolean(config.refreshToken);
  }

  protected connect(config: YouTubeAuthConfig): Promise<void> {
    this.oauth2Client = this.buildClient(config);
    this.applyCredentials(this.oauth2Client, config);

    // Persist tokens whenever the client refreshes them.
    this.oauth2Client.on('tokens', (tokens) => {
      this.saveRefreshedTokens(toConfigPatch(tokens));
      if (this.oauth2Client && this.config) {
        this.applyCredentials(this.oauth2Client, this.config);
      }
      this.reportTokenRefreshed(tokens.expiry_date ?? undefined);
    });

    return Promise.resolve();
  }

  protected override disconnect(): void {
    this.oauth2Client = null;
  }

  getGroup(): IntegrationGroup {
    return IntegrationGroup.YOUTUBE;
  }

  /**
   * The current OAuth2 client, or null. It refreshes its own access token on
   * demand.
   *
   * Returns the stored instance, not a new one per call: YouTubeApiIntegration
   * compares this reference against the one its cached API client was built
   * on to detect that credentials were replaced.
   */
  getAuthClient(): YouTubeOAuth2Client | null {
    return this.oauth2Client;
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
    const message = messageOf(error);
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
   * `access_type: 'offline'` + `prompt: 'consent'` ensures a refresh token is issued.
   */
  getAuthorizationUrl(state: string): string {
    return this.buildClient(this.requireConfig()).generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: [...YOUTUBE_REQUIRED_SCOPES],
      state,
    });
  }

  async exchangeCode(code: string): Promise<void> {
    this.logger.info('Exchanging authorization code for tokens');

    const { tokens } = await this.buildClient(this.requireConfig()).getToken(code);
    this.saveTokens(toConfigPatch(tokens));

    this.logger.info('Successfully exchanged code for tokens');
  }

  private buildClient(config: YouTubeAuthConfig): YouTubeOAuth2Client {
    return new google.auth.OAuth2(config.clientId, config.clientSecret, this.getRedirectUri());
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
}

/**
 * The stored-config fields for Google's tokens. Google omits refresh_token on
 * refreshes, so a patch without one keeps the stored refresh token.
 */
function toConfigPatch(tokens: YouTubeCredentials): Partial<YouTubeAuthConfig> {
  const patch: Partial<YouTubeAuthConfig> = {};
  if (tokens.access_token) {
    patch.accessToken = tokens.access_token;
  }
  if (tokens.refresh_token) {
    patch.refreshToken = tokens.refresh_token;
  }
  if (tokens.expiry_date !== undefined && tokens.expiry_date !== null) {
    patch.expiryDate = tokens.expiry_date;
  }
  const grantedScopes = parseScopes(tokens.scope);
  if (grantedScopes) {
    patch.grantedScopes = grantedScopes;
  }
  return patch;
}
