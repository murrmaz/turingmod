import { IntegrationGroup, IntegrationStatus } from '@turingmod/shared';
import type {
  HelixChannelUpdate,
  HelixCreateCustomRewardData,
  HelixUpdateCustomRewardData,
} from '@twurple/api';
import { ApiClient } from '@twurple/api';
import { HttpStatusCodeError } from '@twurple/api-call';
import { CachedRefreshFailureError, type RefreshingAuthProvider } from '@twurple/auth';
import { injectable, singleton } from 'tsyringe';
import { EventBus } from '../../../core/EventBus.js';
import { Logger } from '../../../utils/Logger.js';
import { BaseIntegration } from '../../BaseIntegration.js';
import { DependencyFailurePolicy, type IIntegration } from '../../interfaces/IIntegration.js';
import { TwitchAuthIntegration } from './TwitchAuthIntegration.js';

/**
 * Twitch API Configuration
 */
export type TwitchApiConfig = Record<string, unknown>;

/**
 * Result of a shoutout attempt
 */
export interface ShoutoutResult {
  sent: boolean;
  reason?: 'global_cooldown' | 'target_cooldown';
  retryAfterMs?: number;
}

/**
 * Twitch API Integration
 * Handles Twitch Helix API calls
 *
 * Responsibilities:
 * - Making Helix API requests
 * - Rate limiting
 * - Caching responses (optional)
 * - Exposing API methods to commands and other integrations
 *
 * Depends on: TwitchAuthIntegration
 */
@injectable()
@singleton()
export class TwitchApiIntegration extends BaseIntegration {
  readonly name = 'twitch-api';
  readonly version = '1.0.0';

  private apiClient: ApiClient | null = null;
  private authProvider: RefreshingAuthProvider | null = null;
  private shoutoutCooldowns = new Map<string, number>();
  private lastShoutoutTimestamp = 0;

  constructor(
    private eventBus: EventBus,
    logger: Logger,
    private authIntegration: TwitchAuthIntegration
  ) {
    super(logger, { component: 'TwitchAPI' });
  }

  /**
   * Get integration dependencies
   */
  getDependencies(): IIntegration[] {
    return [this.authIntegration];
  }

  /**
   * Holds nothing bound to the auth grant — the client is resolved on access —
   * so a Twitch auth failure blocks this integration rather than stopping it.
   * Stopping would also clear the shoutout cooldowns, which have nothing to do
   * with auth.
   */
  override get dependencyFailurePolicy(): DependencyFailurePolicy {
    return DependencyFailurePolicy.BLOCK;
  }

  getGroup(): IntegrationGroup {
    return IntegrationGroup.TWITCH;
  }

  initialize(_config: Record<string, unknown>): Promise<void> {
    this.logger.info('Twitch API integration initialized (no config needed)');
    return Promise.resolve();
  }

  start(): Promise<void> {
    this.logger.debug('Starting Twitch API integration');
    this.setStatus(IntegrationStatus.CONNECTING);

    try {
      const apiClient = this.resolveApiClient();

      if (!apiClient) {
        throw new Error('TwitchAuthIntegration must be started before TwitchApiIntegration');
      }

      this.setStatus(IntegrationStatus.CONNECTED);
      this.logger.info('Twitch API integration started successfully (auth provider configured)');

      return Promise.resolve();
    } catch (error) {
      this.logger.error('Failed to start Twitch API integration', error);
      this.setStatus(
        IntegrationStatus.ERROR,
        error instanceof Error ? error.message : 'Unknown error'
      );
      throw error;
    }
  }

  stop(): Promise<void> {
    this.logger.debug('Stopping Twitch API integration');

    this.apiClient = null;
    this.authProvider = null;
    this.shoutoutCooldowns.clear();
    this.lastShoutoutTimestamp = 0;
    this.setStatus(IntegrationStatus.DISCONNECTED);

    this.logger.debug('Twitch API integration stopped');
    return Promise.resolve();
  }

  /**
   * Get the API client for use by commands and other integrations
   */
  getApiClient(): ApiClient | null {
    return this.resolveApiClient();
  }

  /**
   * Return a client built on the auth integration's *current* auth provider,
   * rebuilding it if the provider has been replaced since.
   *
   * TwitchAuthIntegration creates a fresh RefreshingAuthProvider every time it
   * starts, so a client captured once at start() would keep calling Twitch
   * through a provider that can no longer refresh — silently, until the access
   * token aged out. Resolving on access instead means the stale-reference case
   * cannot arise, rather than being swept up afterwards by the manager's
   * cascade. (The cascade still matters for the EventSub listener, which owns
   * its provider for the life of its WebSocket and cannot be re-pointed.)
   */
  private resolveApiClient(): ApiClient | null {
    // Refuse to act at all while auth isn't connected. markAuthRequired()
    // sets NEEDS_REAUTH without discarding the provider, so the provider
    // below can be perfectly non-null and still unable to refresh — which is
    // what would make a BLOCK-policy integration keep calling Twitch with
    // credentials it has already been told are dead.
    const authProvider =
      this.authIntegration.getStatus() === IntegrationStatus.CONNECTED
        ? this.authIntegration.getAuthProvider()
        : null;

    if (!authProvider) {
      this.apiClient = null;
      this.authProvider = null;
      return null;
    }

    if (this.apiClient && this.authProvider === authProvider) {
      return this.apiClient;
    }

    if (this.authProvider) {
      this.logger.info('Twitch auth provider was replaced; rebuilding API client');
    }

    this.authProvider = authProvider;
    this.apiClient = new ApiClient({ authProvider });
    return this.apiClient;
  }

  /**
   * Run a Helix API call through the live client, detecting when Twitch
   * rejects it because the OAuth grant itself is gone (not just some other
   * API error) and reporting that the same way TwitchEventSubIntegration
   * does — by publishing a fact on the event bus rather than reaching into
   * TwitchAuthIntegration directly.
   */
  private async call<T>(fn: (apiClient: ApiClient) => Promise<T>): Promise<T> {
    const apiClient = this.resolveApiClient();
    if (!apiClient) {
      throw new Error('API client not initialized');
    }

    try {
      return await fn(apiClient);
    } catch (error) {
      if (isAuthorizationRevokedError(error)) {
        this.setStatus(
          IntegrationStatus.NEEDS_REAUTH,
          'Twitch rejected an API call as unauthorized — re-authorization required'
        );
        this.eventBus.emit('twitch.authorization-revoked', { reason: 'api-call-unauthorized' });
      }
      throw error;
    }
  }

  /**
   * Get channel information
   */
  async getChannel(userId: string) {
    return await this.call((apiClient) => apiClient.channels.getChannelInfoById(userId));
  }

  /**
   * Get user by username
   */
  async getUserByName(username: string) {
    return await this.call((apiClient) => apiClient.users.getUserByName(username));
  }

  /**
   * Create a clip
   */
  async createClip(broadcasterId: string) {
    return await this.call((apiClient) =>
      apiClient.clips.createClip({
        channel: broadcasterId,
      })
    );
  }

  /**
   * Send a chat message
   */
  async sendChatMessage(broadcasterId: string, message: string) {
    return await this.call((apiClient) => apiClient.chat.sendChatMessage(broadcasterId, message));
  }

  /**
   * Send a chat announcement
   */
  async sendAnnouncement(broadcasterId: string, message: string) {
    await this.call((apiClient) => apiClient.chat.sendAnnouncement(broadcasterId, { message }));
  }

  /**
   * Delete a chat message, or all messages if no messageId is provided
   */
  async deleteChatMessage(broadcasterId: string, messageId?: string) {
    await this.call((apiClient) =>
      apiClient.moderation.deleteChatMessages(broadcasterId, messageId)
    );
  }

  /**
   * Permanently ban a user from the channel
   */
  async banUser(broadcasterId: string, userId: string, reason: string) {
    return await this.call((apiClient) =>
      apiClient.moderation.banUser(broadcasterId, {
        user: userId,
        reason,
      })
    );
  }

  /**
   * Timeout a user for a specified duration
   */
  async timeoutUser(broadcasterId: string, userId: string, duration: number, reason: string) {
    return await this.call((apiClient) =>
      apiClient.moderation.banUser(broadcasterId, {
        user: userId,
        duration,
        reason,
      })
    );
  }

  /**
   * Remove a ban or timeout from a user
   */
  async unbanUser(broadcasterId: string, userId: string) {
    await this.call((apiClient) => apiClient.moderation.unbanUser(broadcasterId, userId));
  }

  /**
   * Warn a user in chat
   */
  async warnUser(broadcasterId: string, userId: string, reason: string) {
    return await this.call((apiClient) =>
      apiClient.moderation.warnUser(broadcasterId, userId, reason)
    );
  }

  // ── Channel Info ──────────────────────────────────────────────────────

  /**
   * Update channel information (title, game, tags, etc.)
   */
  async updateChannelInfo(userId: string, data: HelixChannelUpdate): Promise<void> {
    await this.call((apiClient) => apiClient.channels.updateChannelInfo(userId, data));
  }

  /**
   * Set the stream title
   */
  async setStreamTitle(userId: string, title: string): Promise<void> {
    await this.updateChannelInfo(userId, { title });
  }

  /**
   * Set the stream game/category by game ID
   */
  async setStreamGame(userId: string, gameId: string): Promise<void> {
    await this.updateChannelInfo(userId, { gameId });
  }

  /**
   * Set the stream tags
   */
  async setStreamTags(userId: string, tags: string[]): Promise<void> {
    await this.updateChannelInfo(userId, { tags });
  }

  /**
   * Search for a game/category by name
   */
  async searchGame(gameName: string) {
    return await this.call((apiClient) => apiClient.games.getGameByName(gameName));
  }

  /**
   * Get user by user ID
   */
  async getUserById(userId: string) {
    return await this.call((apiClient) => apiClient.users.getUserById(userId));
  }

  // ── Followers ─────────────────────────────────────────────────────────

  /**
   * Get channel followers, optionally filtered to a specific user.
   * Each follower has a followDate for computing follow age.
   */
  async getChannelFollowers(broadcasterId: string, userId?: string) {
    return await this.call((apiClient) =>
      apiClient.channels.getChannelFollowers(broadcasterId, userId)
    );
  }

  // ── Streams ───────────────────────────────────────────────────────────

  /**
   * Get the current stream for a user. Returns null if not live.
   * Use stream.startDate to calculate uptime.
   */
  async getStream(userId: string) {
    return await this.call((apiClient) => apiClient.streams.getStreamByUserId(userId));
  }

  /**
   * Create a stream marker at the current position in the broadcast.
   */
  async createStreamMarker(broadcasterId: string, description?: string) {
    return await this.call((apiClient) =>
      apiClient.streams.createStreamMarker(broadcasterId, description)
    );
  }

  // ── Shoutout ──────────────────────────────────────────────────────────

  /**
   * Send a shoutout to another broadcaster with cooldown enforcement.
   * Twitch rate limits: once per 2 minutes globally, same target once per 60 minutes.
   */
  async shoutoutUser(fromBroadcasterId: string, toUserId: string): Promise<ShoutoutResult> {
    const now = Date.now();
    const globalCooldownMs = 2 * 60 * 1000;
    const targetCooldownMs = 60 * 60 * 1000;

    const timeSinceLastShoutout = now - this.lastShoutoutTimestamp;
    if (this.lastShoutoutTimestamp > 0 && timeSinceLastShoutout < globalCooldownMs) {
      return {
        sent: false,
        reason: 'global_cooldown',
        retryAfterMs: globalCooldownMs - timeSinceLastShoutout,
      };
    }

    const lastTargetShoutout = this.shoutoutCooldowns.get(toUserId);
    if (lastTargetShoutout !== undefined) {
      const timeSinceTargetShoutout = now - lastTargetShoutout;
      if (timeSinceTargetShoutout < targetCooldownMs) {
        return {
          sent: false,
          reason: 'target_cooldown',
          retryAfterMs: targetCooldownMs - timeSinceTargetShoutout,
        };
      }
    }

    await this.call((apiClient) => apiClient.chat.shoutoutUser(fromBroadcasterId, toUserId));

    this.lastShoutoutTimestamp = now;
    this.shoutoutCooldowns.set(toUserId, now);

    return { sent: true };
  }

  // ── Channel Points ────────────────────────────────────────────────────

  /**
   * Get all custom channel point rewards.
   */
  async getCustomRewards(broadcasterId: string, onlyManageable?: boolean) {
    return await this.call((apiClient) =>
      apiClient.channelPoints.getCustomRewards(broadcasterId, onlyManageable)
    );
  }

  /**
   * Get a specific custom channel point reward by ID.
   */
  async getCustomRewardById(broadcasterId: string, rewardId: string) {
    return await this.call((apiClient) =>
      apiClient.channelPoints.getCustomRewardById(broadcasterId, rewardId)
    );
  }

  /**
   * Create a new custom channel point reward.
   */
  async createCustomReward(broadcasterId: string, data: HelixCreateCustomRewardData) {
    return await this.call((apiClient) =>
      apiClient.channelPoints.createCustomReward(broadcasterId, data)
    );
  }

  /**
   * Update an existing custom channel point reward (e.g., toggle enabled/paused).
   */
  async updateCustomReward(
    broadcasterId: string,
    rewardId: string,
    data: HelixUpdateCustomRewardData
  ) {
    return await this.call((apiClient) =>
      apiClient.channelPoints.updateCustomReward(broadcasterId, rewardId, data)
    );
  }

  /**
   * Mark redemptions of a reward this application created as fulfilled, or cancel them (which
   * refunds the viewer). Only redemptions still in the request queue can change status.
   */
  async updateRedemptionStatus(
    broadcasterId: string,
    rewardId: string,
    redemptionIds: string[],
    status: 'FULFILLED' | 'CANCELED'
  ) {
    return await this.call((apiClient) =>
      apiClient.channelPoints.updateRedemptionStatusByIds(
        broadcasterId,
        rewardId,
        redemptionIds,
        status
      )
    );
  }

  /**
   * Delete a custom channel point reward.
   */
  async deleteCustomReward(broadcasterId: string, rewardId: string): Promise<void> {
    await this.call((apiClient) =>
      apiClient.channelPoints.deleteCustomReward(broadcasterId, rewardId)
    );
  }

  // ── Schedule ──────────────────────────────────────────────────────────

  /**
   * Get the stream schedule for a broadcaster.
   */
  async getSchedule(broadcasterId: string): ReturnType<ApiClient['schedule']['getSchedule']> {
    return await this.call((apiClient) => apiClient.schedule.getSchedule(broadcasterId));
  }

  // ── Ad Management ─────────────────────────────────────────────────────

  /**
   * Get the broadcaster's ad schedule (next ad, snooze count, preroll free time, etc.)
   */
  async getAdSchedule(broadcasterId: string) {
    return await this.call((apiClient) => apiClient.channels.getAdSchedule(broadcasterId));
  }

  /**
   * Snooze the broadcaster's next ad break, if a snooze is available.
   */
  async snoozeNextAd(broadcasterId: string): ReturnType<ApiClient['channels']['snoozeNextAd']> {
    return await this.call((apiClient) => apiClient.channels.snoozeNextAd(broadcasterId));
  }

  // ── Videos ────────────────────────────────────────────────────────────

  /**
   * Get videos for a user (most recent first by default).
   */
  async getVideosByUser(userId: string) {
    return await this.call((apiClient) => apiClient.videos.getVideosByUser(userId));
  }

  /**
   * Delete videos by their IDs.
   */
  async deleteVideos(broadcasterId: string, videoIds: string[]): Promise<void> {
    await this.call((apiClient) => apiClient.videos.deleteVideosByIds(broadcasterId, videoIds));
  }

  // ── Content Classification Labels ─────────────────────────────────────

  /**
   * Get all available content classification labels.
   */
  async getContentClassificationLabels(locale?: string) {
    return await this.call((apiClient) => apiClient.contentClassificationLabels.getAll(locale));
  }

  /**
   * Set content classification labels on a channel.
   */
  async setContentClassificationLabels(userId: string, labelIds: string[]): Promise<void> {
    await this.updateChannelInfo(userId, { contentClassificationLabels: labelIds });
  }
}

/**
 * Whether a Helix API call failure means the OAuth grant itself is dead,
 * rather than some unrelated API error (rate limit, bad request, 404, etc.).
 * `CachedRefreshFailureError` means Twurple already knows this user's token
 * can't be refreshed; a 401 means Twitch rejected this specific request as
 * unauthorized.
 */
function isAuthorizationRevokedError(error: unknown): boolean {
  if (error instanceof CachedRefreshFailureError) {
    return true;
  }
  return error instanceof HttpStatusCodeError && error.statusCode === 401;
}
