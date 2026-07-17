import { IntegrationStatus } from '@turingmod/shared';
import { ApiClient } from '@twurple/api';
import type {
  HelixChannelUpdate,
  HelixCreateCustomRewardData,
  HelixUpdateCustomRewardData,
} from '@twurple/api';
import type { RefreshingAuthProvider } from '@twurple/auth';
import type { EventBus } from '../../core/EventBus.js';
import type { Logger } from '../../utils/Logger.js';
import { BaseIntegration } from '../BaseIntegration.js';
import type { TwitchAuthIntegration } from './TwitchAuthIntegration.js';

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
  getDependencies(): string[] {
    return ['twitch-auth'];
  }

  initialize(_config: Record<string, unknown>): Promise<void> {
    this.logger.info('Twitch API integration initialized (no config needed)');
    return Promise.resolve();
  }

  start(): Promise<void> {
    this.logger.info('Starting Twitch API integration');
    this.setStatus(IntegrationStatus.CONNECTING);

    try {
      // Get auth provider from auth integration
      this.authProvider = this.authIntegration.getAuthProvider();

      if (!this.authProvider) {
        throw new Error('TwitchAuthIntegration must be started before TwitchApiIntegration');
      }

      // Create API client
      this.apiClient = new ApiClient({
        authProvider: this.authProvider,
      });

      this.setStatus(IntegrationStatus.CONNECTED);
      this.logger.info('Twitch API integration started successfully (auth provider configured)');

      // Emit event that API is ready
      this.eventBus.emit('twitch.api.ready', {
        apiClient: this.apiClient,
      });

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
    this.logger.info('Stopping Twitch API integration');

    this.apiClient = null;
    this.authProvider = null;
    this.shoutoutCooldowns.clear();
    this.lastShoutoutTimestamp = 0;
    this.setStatus(IntegrationStatus.DISCONNECTED);

    this.logger.info('Twitch API integration stopped');
    return Promise.resolve();
  }

  /**
   * Get the API client for use by commands and other integrations
   */
  getApiClient(): ApiClient | null {
    return this.apiClient;
  }

  /**
   * Get channel information
   */
  async getChannel(userId: string) {
    if (!this.apiClient) {
      throw new Error('API client not initialized');
    }

    return await this.apiClient.channels.getChannelInfoById(userId);
  }

  /**
   * Get user by username
   */
  async getUserByName(username: string) {
    if (!this.apiClient) {
      throw new Error('API client not initialized');
    }

    return await this.apiClient.users.getUserByName(username);
  }

  /**
   * Create a clip
   */
  async createClip(broadcasterId: string) {
    if (!this.apiClient) {
      throw new Error('API client not initialized');
    }

    return await this.apiClient.clips.createClip({
      channel: broadcasterId,
    });
  }

  /**
   * Send a chat message
   */
  async sendChatMessage(broadcasterId: string, message: string) {
    if (!this.apiClient) {
      throw new Error('API client not initialized');
    }

    return await this.apiClient.chat.sendChatMessage(broadcasterId, message);
  }

  /**
   * Send a chat announcement
   */
  async sendAnnouncement(broadcasterId: string, message: string) {
    if (!this.apiClient) {
      throw new Error('API client not initialized');
    }

    await this.apiClient.chat.sendAnnouncement(broadcasterId, { message });
  }

  /**
   * Delete a chat message, or all messages if no messageId is provided
   */
  async deleteChatMessage(broadcasterId: string, messageId?: string) {
    if (!this.apiClient) {
      throw new Error('API client not initialized');
    }

    await this.apiClient.moderation.deleteChatMessages(broadcasterId, messageId);
  }

  /**
   * Permanently ban a user from the channel
   */
  async banUser(broadcasterId: string, userId: string, reason: string) {
    if (!this.apiClient) {
      throw new Error('API client not initialized');
    }

    return await this.apiClient.moderation.banUser(broadcasterId, {
      user: userId,
      reason,
    });
  }

  /**
   * Timeout a user for a specified duration
   */
  async timeoutUser(broadcasterId: string, userId: string, duration: number, reason: string) {
    if (!this.apiClient) {
      throw new Error('API client not initialized');
    }

    return await this.apiClient.moderation.banUser(broadcasterId, {
      user: userId,
      duration,
      reason,
    });
  }

  /**
   * Remove a ban or timeout from a user
   */
  async unbanUser(broadcasterId: string, userId: string) {
    if (!this.apiClient) {
      throw new Error('API client not initialized');
    }

    await this.apiClient.moderation.unbanUser(broadcasterId, userId);
  }

  /**
   * Warn a user in chat
   */
  async warnUser(broadcasterId: string, userId: string, reason: string) {
    if (!this.apiClient) {
      throw new Error('API client not initialized');
    }

    return await this.apiClient.moderation.warnUser(broadcasterId, userId, reason);
  }

  // ── Channel Info ──────────────────────────────────────────────────────

  /**
   * Update channel information (title, game, tags, etc.)
   */
  async updateChannelInfo(userId: string, data: HelixChannelUpdate): Promise<void> {
    if (!this.apiClient) {
      throw new Error('API client not initialized');
    }

    await this.apiClient.channels.updateChannelInfo(userId, data);
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
    if (!this.apiClient) {
      throw new Error('API client not initialized');
    }

    return await this.apiClient.games.getGameByName(gameName);
  }

  /**
   * Get user by user ID
   */
  async getUserById(userId: string) {
    if (!this.apiClient) {
      throw new Error('API client not initialized');
    }

    return await this.apiClient.users.getUserById(userId);
  }

  // ── Followers ─────────────────────────────────────────────────────────

  /**
   * Get channel followers, optionally filtered to a specific user.
   * Each follower has a followDate for computing follow age.
   */
  async getChannelFollowers(broadcasterId: string, userId?: string) {
    if (!this.apiClient) {
      throw new Error('API client not initialized');
    }

    return await this.apiClient.channels.getChannelFollowers(broadcasterId, userId);
  }

  // ── Streams ───────────────────────────────────────────────────────────

  /**
   * Get the current stream for a user. Returns null if not live.
   * Use stream.startDate to calculate uptime.
   */
  async getStream(userId: string) {
    if (!this.apiClient) {
      throw new Error('API client not initialized');
    }

    return await this.apiClient.streams.getStreamByUserId(userId);
  }

  /**
   * Create a stream marker at the current position in the broadcast.
   */
  async createStreamMarker(broadcasterId: string, description?: string) {
    if (!this.apiClient) {
      throw new Error('API client not initialized');
    }

    return await this.apiClient.streams.createStreamMarker(broadcasterId, description);
  }

  // ── Shoutout ──────────────────────────────────────────────────────────

  /**
   * Send a shoutout to another broadcaster with cooldown enforcement.
   * Twitch rate limits: once per 2 minutes globally, same target once per 60 minutes.
   */
  async shoutoutUser(fromBroadcasterId: string, toUserId: string): Promise<ShoutoutResult> {
    if (!this.apiClient) {
      throw new Error('API client not initialized');
    }

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

    await this.apiClient.chat.shoutoutUser(fromBroadcasterId, toUserId);

    this.lastShoutoutTimestamp = now;
    this.shoutoutCooldowns.set(toUserId, now);

    return { sent: true };
  }

  // ── Channel Points ────────────────────────────────────────────────────

  /**
   * Get all custom channel point rewards.
   */
  async getCustomRewards(broadcasterId: string, onlyManageable?: boolean) {
    if (!this.apiClient) {
      throw new Error('API client not initialized');
    }

    return await this.apiClient.channelPoints.getCustomRewards(broadcasterId, onlyManageable);
  }

  /**
   * Get a specific custom channel point reward by ID.
   */
  async getCustomRewardById(broadcasterId: string, rewardId: string) {
    if (!this.apiClient) {
      throw new Error('API client not initialized');
    }

    return await this.apiClient.channelPoints.getCustomRewardById(broadcasterId, rewardId);
  }

  /**
   * Create a new custom channel point reward.
   */
  async createCustomReward(broadcasterId: string, data: HelixCreateCustomRewardData) {
    if (!this.apiClient) {
      throw new Error('API client not initialized');
    }

    return await this.apiClient.channelPoints.createCustomReward(broadcasterId, data);
  }

  /**
   * Update an existing custom channel point reward (e.g., toggle enabled/paused).
   */
  async updateCustomReward(
    broadcasterId: string,
    rewardId: string,
    data: HelixUpdateCustomRewardData
  ) {
    if (!this.apiClient) {
      throw new Error('API client not initialized');
    }

    return await this.apiClient.channelPoints.updateCustomReward(broadcasterId, rewardId, data);
  }

  /**
   * Delete a custom channel point reward.
   */
  async deleteCustomReward(broadcasterId: string, rewardId: string): Promise<void> {
    if (!this.apiClient) {
      throw new Error('API client not initialized');
    }

    await this.apiClient.channelPoints.deleteCustomReward(broadcasterId, rewardId);
  }

  // ── Schedule ──────────────────────────────────────────────────────────

  /**
   * Get the stream schedule for a broadcaster.
   */
  async getSchedule(broadcasterId: string): ReturnType<ApiClient['schedule']['getSchedule']> {
    if (!this.apiClient) {
      throw new Error('API client not initialized');
    }

    return await this.apiClient.schedule.getSchedule(broadcasterId);
  }

  // ── Ad Management ─────────────────────────────────────────────────────

  /**
   * Get the broadcaster's ad schedule (next ad, snooze count, preroll free time, etc.)
   */
  async getAdSchedule(broadcasterId: string) {
    if (!this.apiClient) {
      throw new Error('API client not initialized');
    }

    return await this.apiClient.channels.getAdSchedule(broadcasterId);
  }

  /**
   * Snooze the broadcaster's next ad break, if a snooze is available.
   */
  async snoozeNextAd(broadcasterId: string): ReturnType<ApiClient['channels']['snoozeNextAd']> {
    if (!this.apiClient) {
      throw new Error('API client not initialized');
    }

    return await this.apiClient.channels.snoozeNextAd(broadcasterId);
  }

  // ── Videos ────────────────────────────────────────────────────────────

  /**
   * Get videos for a user (most recent first by default).
   */
  async getVideosByUser(userId: string) {
    if (!this.apiClient) {
      throw new Error('API client not initialized');
    }

    return await this.apiClient.videos.getVideosByUser(userId);
  }

  /**
   * Delete videos by their IDs.
   */
  async deleteVideos(broadcasterId: string, videoIds: string[]): Promise<void> {
    if (!this.apiClient) {
      throw new Error('API client not initialized');
    }

    await this.apiClient.videos.deleteVideosByIds(broadcasterId, videoIds);
  }

  // ── Content Classification Labels ─────────────────────────────────────

  /**
   * Get all available content classification labels.
   */
  async getContentClassificationLabels(locale?: string) {
    if (!this.apiClient) {
      throw new Error('API client not initialized');
    }

    return await this.apiClient.contentClassificationLabels.getAll(locale);
  }

  /**
   * Set content classification labels on a channel.
   */
  async setContentClassificationLabels(userId: string, labelIds: string[]): Promise<void> {
    await this.updateChannelInfo(userId, { contentClassificationLabels: labelIds });
  }
}
