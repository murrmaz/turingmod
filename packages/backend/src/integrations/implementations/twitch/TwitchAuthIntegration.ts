import { type IntegrationGroup, IntegrationName } from '@turingmod/shared';
import { HttpStatusCodeError } from '@twurple/api-call';
import type { AccessToken, RefreshingAuthProvider } from '@twurple/auth';
import {
  InvalidTokenError,
  InvalidTokenTypeError,
  RefreshingAuthProvider as TwurpleRefreshingAuthProvider,
} from '@twurple/auth';
import { singleton } from 'tsyringe';
import { z } from 'zod';
import { IntegrationStateRepository } from '../../../database/repositories/IntegrationStateRepository.js';
import { TuringModConfig } from '../../../utils/Config.js';
import { Logger } from '../../../utils/Logger.js';
import {
  type StandardOAuthConfig,
  StandardOAuthConfigSchema,
  StandardOAuthIntegration,
} from '../../StandardOAuthIntegration.js';
import { redactTokenRequest } from './redactTokenRequest.js';
import { TWITCH_GROUP } from './twitchGroup.js';

/**
 * A response from Twitch's token endpoint for a code exchange. Unlike OAuth 2.0's space-separated
 * string, Twitch sends `scope` as an array.
 */
const TwitchTokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).exactOptional(),
  expires_in: z.number().positive().exactOptional(),
  scope: z.array(z.string()),
});

type TwitchTokenResponse = z.infer<typeof TwitchTokenResponseSchema>;

/**
 * Required OAuth scopes for the Twitch integration.
 * Single source of truth: nothing else names them, the authorization URL included.
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
export class TwitchAuthIntegration extends StandardOAuthIntegration<
  StandardOAuthConfig,
  TwitchTokenResponse
> {
  readonly name = IntegrationName.TWITCH_AUTH;

  protected readonly requiredScopes = TWITCH_REQUIRED_SCOPES;
  protected readonly callbackPath = '/callback/twitch';
  /** Twitch accepts plain-HTTP redirects only to `localhost`, not `127.0.0.1`. */
  protected readonly redirectHost = 'localhost';
  protected readonly configSchema = StandardOAuthConfigSchema;
  protected readonly authorizeUrl = 'https://id.twitch.tv/oauth2/authorize';
  protected readonly tokenUrl = 'https://id.twitch.tv/oauth2/token';
  protected readonly clientAuthentication = 'body';
  protected readonly tokenResponseSchema = TwitchTokenResponseSchema;

  private authProvider: RefreshingAuthProvider | null = null;
  private userId: string | null = null;

  constructor(
    logger: Logger,
    stateRepo: IntegrationStateRepository,
    serverConfig: TuringModConfig
  ) {
    super(logger, 'TwitchAuth', stateRepo, serverConfig);
  }

  protected async connect(config: StandardOAuthConfig): Promise<void> {
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
      this.saveRefreshedTokens(accessTokenPatch(newToken));
      this.reportTokenRefreshed(
        newToken.expiresIn === null
          ? undefined
          : newToken.obtainmentTimestamp + newToken.expiresIn * 1000
      );
    });

    const provider = this.authProvider;
    provider.onRefreshFailure((userId, error) => {
      this.onRefreshFailure(provider, userId, error);
    });

    try {
      // Returns the authenticated user ID
      this.userId = await provider.addUserForToken(toAccessToken(config));
    } catch (error) {
      // A refresh here is made directly, so it never reaches onRefreshFailure.
      redactTokenRequest(error);
      throw error;
    }
  }

  /**
   * A refresh failed. Only Twitch refusing it means the grant is gone. Anything else (no network,
   * Twitch having a bad moment) leaves the grant as good as it was, so chat and EventSub keep
   * running and the next call that needs a token tries again.
   */
  private onRefreshFailure(provider: RefreshingAuthProvider, userId: string, error: Error): void {
    // Twurple rethrows this same error to whoever asked for the token, once this returns.
    redactTokenRequest(error);
    if (provider !== this.authProvider) {
      return; // stopped or restarted meanwhile
    }

    if (this.isReauthRequiredError(error)) {
      this.logger.error('Token refresh failed', error);
      this.markAuthRequired();
      return;
    }

    // Twurple refuses a user whose refresh failed, for any reason, until they're added again.
    provider.addUser(userId, toAccessToken(this.requireConfig()));
    this.reportFailure(
      new Error('Could not refresh the Twitch token; the next call will try again', {
        cause: error,
      })
    );
  }

  protected override disconnect(): void {
    this.authProvider = null;
    // Clear the id alongside the provider: leaving it set made getAuthenticatedUserId()
    // report a usable broadcaster after a stop(), while every call behind it would fail.
    this.userId = null;
  }

  /**
   * Whether a failed connect() or refresh means the user has to authorize again, rather than
   * that trying later might work. Twurple throws `InvalidTokenError`/`InvalidTokenTypeError`
   * directly for a missing or malformed token; a dead refresh token surfaces as Twitch's token
   * endpoint refusing the request (a 400, or a 403 for client credentials it no longer accepts).
   * A timeout or a rate limit refuses nothing.
   */
  protected override isReauthRequiredError(error: unknown): boolean {
    if (error instanceof InvalidTokenError || error instanceof InvalidTokenTypeError) {
      return true;
    }
    if (!(error instanceof HttpStatusCodeError)) {
      return false;
    }
    const { statusCode } = error;
    return statusCode >= 400 && statusCode < 500 && statusCode !== 408 && statusCode !== 429;
  }

  override getGroup(): IntegrationGroup {
    return TWITCH_GROUP;
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

  /** Through Twurple's token shape, which its refreshes hand over too. */
  protected toConfigPatch(data: TwitchTokenResponse): Partial<StandardOAuthConfig> {
    return accessTokenPatch({
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? null,
      expiresIn: data.expires_in ?? null,
      obtainmentTimestamp: Date.now(),
      scope: data.scope,
    });
  }
}

/** The stored tokens in the shape Twurple takes them. */
function toAccessToken(config: StandardOAuthConfig): AccessToken {
  return {
    accessToken: config.accessToken,
    refreshToken: config.refreshToken,
    expiresIn: config.expiresIn,
    obtainmentTimestamp: config.obtainmentTimestamp || Date.now(),
    scope: config.grantedScopes,
  } as AccessToken;
}

/** The stored-config fields for a Twurple token (only those it has, under exactOptionalPropertyTypes). */
function accessTokenPatch(token: AccessToken): Partial<StandardOAuthConfig> {
  const patch: Partial<StandardOAuthConfig> = {
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
