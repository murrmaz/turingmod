import { IntegrationGroup, IntegrationStatus } from '@turingmod/shared';
import { HttpStatusCodeError } from '@twurple/api-call';
import type { AccessToken, RefreshingAuthProvider } from '@twurple/auth';
import {
  InvalidTokenError,
  InvalidTokenTypeError,
  RefreshingAuthProvider as TwurpleRefreshingAuthProvider,
} from '@twurple/auth';
import { singleton } from 'tsyringe';
import { z } from 'zod';
import { EventBus } from '../../../core/EventBus.js';
import { IntegrationStateRepository } from '../../../database/repositories/IntegrationStateRepository.js';
import { TuringModConfig } from '../../../utils/Config.js';
import { Logger } from '../../../utils/Logger.js';
import { OAuthConfigBaseSchema, OAuthIntegration } from '../../OAuthIntegration.js';

/**
 * Twitch Auth Configuration
 */
export const TwitchAuthConfigSchema = OAuthConfigBaseSchema.extend({
  accessToken: z.string().exactOptional(),
  refreshToken: z.string().exactOptional(),
  /** Seconds the access token was issued for. */
  expiresIn: z.number().exactOptional(),
  obtainmentTimestamp: z.number().exactOptional(),
});

export type TwitchAuthConfig = z.infer<typeof TwitchAuthConfigSchema>;

/** A response from Twitch's token endpoint for a code exchange. */
const TwitchTokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).exactOptional(),
  expires_in: z.number().positive().exactOptional(),
  scope: z.array(z.string()),
});

/**
 * Required OAuth scopes for the Twitch integration.
 * Single source of truth — the frontend and OAuthHandler should not specify scopes.
 */
export const TWITCH_REQUIRED_SCOPES = [
  // Chat over EventSub (channel.chat.message) and Helix Send Chat Message. The IRC-era
  // chat:read/chat:edit aren't needed: nothing connects to IRC.
  'user:read:chat',
  'user:write:chat',
  // The channel.subscribe EventSub topic
  'channel:read:subscriptions',
  // Changing the title, category, tags and content labels, and creating stream markers
  'channel:manage:broadcast',
  // Deleting past broadcasts (`!delvod`)
  'channel:manage:videos',
  // Ad schedule reads (Get Ad Schedule, `!ad`) and the channel.ad_break.begin EventSub topic
  'channel:read:ads',
  // Snoozing the next ad break
  'channel:manage:ads',
  // Creating, correcting and pausing channel point rewards, resolving redemptions, and the
  // channel.channel_points_custom_reward_redemption.add EventSub topic
  'channel:manage:redemptions',
  // Follow dates (`!followage`) and the channel.follow EventSub topic
  'moderator:read:followers',
  // Timeouts and deleting messages (chat moderation)
  'moderator:manage:banned_users',
  'moderator:manage:chat_messages',
  // Native shoutouts (raid shoutouts, `!so`)
  'moderator:manage:shoutouts',
  // Highlighted chat announcements (interval messages)
  'moderator:manage:announcements',
];

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
@singleton()
export class TwitchAuthIntegration extends OAuthIntegration<TwitchAuthConfig> {
  readonly name = 'twitch-auth';

  protected readonly requiredScopes = TWITCH_REQUIRED_SCOPES;
  protected readonly callbackPath = '/callback/twitch';
  /** Twitch accepts plain-HTTP redirects only to `localhost`, not `127.0.0.1`. */
  protected readonly redirectHost = 'localhost';
  protected readonly configSchema = TwitchAuthConfigSchema;

  private authProvider: RefreshingAuthProvider | null = null;
  private userId: string | null = null;
  private unsubscribeAuthorizationRevoked: (() => void) | null = null;

  constructor(
    private eventBus: EventBus,
    logger: Logger,
    stateRepo: IntegrationStateRepository,
    serverConfig: TuringModConfig
  ) {
    super(logger, 'TwitchAuth', stateRepo, serverConfig);
  }

  protected hasTokens(config: TwitchAuthConfig): boolean {
    return Boolean(config.accessToken);
  }

  protected async connect(config: TwitchAuthConfig): Promise<void> {
    // Other Twitch integrations (e.g. EventSub) can detect that Twitch
    // revoked our authorization independently of our own refresh cycle.
    // Listen rather than being told directly, so this integration decides
    // for itself how to react instead of exposing a setter for its status.
    // Unsubscribe any listener from a prior start() first: IntegrationManager
    // doesn't call stop() after a failed start(), so a retry would otherwise
    // register a duplicate on top of the still-live one.
    this.unsubscribeAuthorizationRevoked?.();
    this.unsubscribeAuthorizationRevoked = this.eventBus.on('twitch.authorizationRevoked', () => {
      this.logger.warn('Authorization revoked (reported by another integration)');
      this.setStatus(
        IntegrationStatus.NEEDS_REAUTH,
        'Twitch revoked authorization — re-authorization required'
      );
    });

    this.authProvider = new TwurpleRefreshingAuthProvider({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
    });

    // Registered before addUserForToken() below, because that call can itself
    // trigger an immediate refresh (if the stored token is already expired)
    // and fire this event synchronously from inside the call — a listener
    // added afterwards would miss it, leaving the refreshed token stranded in
    // memory and never persisted.
    this.authProvider.onRefresh((_userId, newToken) => {
      this.logger.info('Access token refreshed');
      this.saveRefreshedTokens(toConfigPatch(newToken));
      this.reportTokenRefreshed(
        newToken.expiresIn === null
          ? undefined
          : newToken.obtainmentTimestamp + newToken.expiresIn * 1000
      );
    });

    this.authProvider.onRefreshFailure((_userId, error) => {
      this.logger.error('Token refresh failed', error);
      this.setStatus(
        IntegrationStatus.NEEDS_REAUTH,
        'Token refresh failed — re-authorization required'
      );
    });

    // Returns the authenticated user ID
    this.userId = await this.authProvider.addUserForToken({
      accessToken: config.accessToken,
      refreshToken: config.refreshToken,
      expiresIn: config.expiresIn,
      obtainmentTimestamp: config.obtainmentTimestamp || Date.now(),
      scope: config.grantedScopes,
    } as AccessToken);
  }

  protected override disconnect(): void {
    this.unsubscribeAuthorizationRevoked?.();
    this.unsubscribeAuthorizationRevoked = null;

    this.authProvider = null;
    // Clear the id alongside the provider: leaving it set made getAuthenticatedUserId()
    // report a usable broadcaster after a stop(), while every call behind it would fail.
    this.userId = null;
  }

  /**
   * Whether a connect() failure means the refresh token itself is dead
   * (revoked or expired) rather than some transient/unexpected error. Twurple
   * throws `InvalidTokenError`/`InvalidTokenTypeError` directly for a missing
   * or malformed token; a dead refresh token surfaces as Twitch's token
   * endpoint rejecting the refresh request with an HTTP 400.
   */
  protected override isReauthRequiredError(error: unknown): boolean {
    if (error instanceof InvalidTokenError || error instanceof InvalidTokenTypeError) {
      return true;
    }
    return error instanceof HttpStatusCodeError && error.statusCode === 400;
  }

  override getGroup(): IntegrationGroup {
    return IntegrationGroup.TWITCH;
  }

  /**
   * Get the auth provider for use by other integrations.
   *
   * Returns the stored instance, not a new one per call: dependents compare
   * this reference against the one their cached client was built on to detect
   * that the grant was replaced, so a fresh object each call would make them
   * rebuild on every access.
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

  getAuthorizationUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.requireConfig().clientId,
      redirect_uri: this.getRedirectUri(),
      response_type: 'code',
      scope: TWITCH_REQUIRED_SCOPES.join(' '),
      state,
    });

    return `https://id.twitch.tv/oauth2/authorize?${params.toString()}`;
  }

  async exchangeCode(code: string): Promise<void> {
    const config = this.requireConfig();

    this.logger.info('Exchanging authorization code for tokens');

    const response = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: this.getRedirectUri(),
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to exchange code: ${error}`);
    }

    const data = await this.parseTokenResponse(TwitchTokenResponseSchema, response);

    this.saveTokens(
      toConfigPatch({
        accessToken: data.access_token,
        refreshToken: data.refresh_token || null,
        expiresIn: data.expires_in || null,
        obtainmentTimestamp: Date.now(),
        scope: data.scope,
      })
    );

    this.logger.info('Successfully exchanged code for tokens');
  }
}

/** The stored-config fields for a Twurple token (only those it has, under exactOptionalPropertyTypes). */
function toConfigPatch(token: AccessToken): Partial<TwitchAuthConfig> {
  const patch: Partial<TwitchAuthConfig> = {
    accessToken: token.accessToken,
    obtainmentTimestamp: token.obtainmentTimestamp,
  };
  if (token.refreshToken) {
    patch.refreshToken = token.refreshToken;
  }
  if (token.expiresIn) {
    patch.expiresIn = token.expiresIn;
  }
  if (token.scope) {
    patch.grantedScopes = token.scope;
  }
  return patch;
}
