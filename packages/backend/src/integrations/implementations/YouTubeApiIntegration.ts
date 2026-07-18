import { IntegrationStatus } from '@turingmod/shared';
import { google, type youtube_v3 } from 'googleapis';
import type { EventBus } from '../../core/EventBus.js';
import type { Logger } from '../../utils/Logger.js';
import { BaseIntegration } from '../BaseIntegration.js';
import type { YouTubeAuthIntegration } from './YouTubeAuthIntegration.js';

/**
 * YouTube API Configuration
 */
export type YouTubeApiConfig = Record<string, unknown>;

/**
 * Normalized view of the broadcaster's currently active live broadcast. `liveChatId` and the
 * start times are only present while a broadcast is active/upcoming (see multi-platform-chat.md
 * §11), so the Chat integration must idle when this is null.
 */
export interface ActiveBroadcast {
  id: string;
  title: string;
  /** The broadcaster's channel id (analogous to Twitch's broadcasterId). */
  channelId: string | null;
  liveChatId: string | null;
  actualStartTime: string | null;
  scheduledStartTime: string | null;
}

/**
 * YouTube API Integration
 * Wraps the YouTube Data API v3 (liveBroadcasts + liveChatMessages).
 *
 * Responsibilities:
 * - Resolving the active broadcast (+ its liveChatId / start time)
 * - Sending live chat messages
 * - Updating the broadcast title
 * - Exposing typed helpers to commands and the YouTube Chat integration
 *
 * Depends on: YouTubeAuthIntegration
 */
export class YouTubeApiIntegration extends BaseIntegration {
  readonly name = 'youtube-api';
  readonly version = '1.0.0';

  private youtube: youtube_v3.Youtube | null = null;

  constructor(
    private eventBus: EventBus,
    logger: Logger,
    private authIntegration: YouTubeAuthIntegration
  ) {
    super(logger, { component: 'YouTubeAPI' });
  }

  getDependencies(): string[] {
    return ['youtube-auth'];
  }

  initialize(_config: Record<string, unknown>): Promise<void> {
    this.logger.info('YouTube API integration initialized (no config needed)');
    return Promise.resolve();
  }

  start(): Promise<void> {
    this.logger.info('Starting YouTube API integration');
    this.setStatus(IntegrationStatus.CONNECTING);

    try {
      const authClient = this.authIntegration.getAuthClient();
      if (!authClient) {
        throw new Error('YouTubeAuthIntegration must be started (and authorized) first');
      }

      this.youtube = google.youtube({ version: 'v3', auth: authClient });

      this.setStatus(IntegrationStatus.CONNECTED);
      this.logger.info('YouTube API integration started successfully');

      this.eventBus.emit('youtube.api.ready', { youtube: this.youtube });

      return Promise.resolve();
    } catch (error) {
      this.logger.error('Failed to start YouTube API integration', error);
      this.setStatus(
        IntegrationStatus.ERROR,
        error instanceof Error ? error.message : 'Unknown error'
      );
      throw error;
    }
  }

  stop(): Promise<void> {
    this.logger.info('Stopping YouTube API integration');

    this.youtube = null;
    this.setStatus(IntegrationStatus.DISCONNECTED);

    this.logger.info('YouTube API integration stopped');
    return Promise.resolve();
  }

  /**
   * Resolve the broadcaster's currently active live broadcast, or null if not live.
   */
  async getActiveBroadcast(): Promise<ActiveBroadcast | null> {
    const youtube = this.requireClient();

    const response = await youtube.liveBroadcasts.list({
      part: ['snippet', 'status'],
      broadcastStatus: 'active',
      broadcastType: 'all',
      mine: true,
    });

    const broadcast = response.data.items?.[0];
    if (!broadcast?.id) {
      return null;
    }

    const snippet = broadcast.snippet;
    return {
      id: broadcast.id,
      title: snippet?.title ?? '',
      channelId: snippet?.channelId ?? null,
      liveChatId: snippet?.liveChatId ?? null,
      actualStartTime: snippet?.actualStartTime ?? null,
      scheduledStartTime: snippet?.scheduledStartTime ?? null,
    };
  }

  /**
   * Insert a text message into a live chat.
   */
  async sendLiveChatMessage(liveChatId: string, message: string): Promise<void> {
    const youtube = this.requireClient();

    await youtube.liveChatMessages.insert({
      part: ['snippet'],
      requestBody: {
        snippet: {
          liveChatId,
          type: 'textMessageEvent',
          textMessageDetails: {
            messageText: message,
          },
        },
      },
    });
  }

  /**
   * List live chat messages after a page token, for polling. Returns the raw API response so the
   * Chat integration can read `nextPageToken` and `pollingIntervalMillis`.
   */
  async listLiveChatMessages(
    liveChatId: string,
    pageToken?: string
  ): Promise<youtube_v3.Schema$LiveChatMessageListResponse> {
    const youtube = this.requireClient();

    const response = await youtube.liveChatMessages.list({
      liveChatId,
      part: ['snippet', 'authorDetails'],
      ...(pageToken === undefined ? {} : { pageToken }),
    });

    return response.data;
  }

  /**
   * Set the active broadcast's title. YouTube has no game/tags equivalent, so only the title is
   * mutated; the broadcast's scheduledStartTime is preserved (required by liveBroadcasts.update).
   */
  async setBroadcastTitle(title: string): Promise<void> {
    const youtube = this.requireClient();

    const broadcast = await this.getActiveBroadcast();
    if (!broadcast) {
      throw new Error('No active YouTube broadcast to update');
    }

    const snippet: youtube_v3.Schema$LiveBroadcastSnippet = { title };
    if (broadcast.scheduledStartTime !== null) {
      snippet.scheduledStartTime = broadcast.scheduledStartTime;
    }

    await youtube.liveBroadcasts.update({
      part: ['snippet'],
      requestBody: {
        id: broadcast.id,
        snippet,
      },
    });
  }

  /**
   * Milliseconds the active broadcast has been live, or null if offline / no start time yet.
   */
  async getUptime(): Promise<number | null> {
    const broadcast = await this.getActiveBroadcast();
    if (!broadcast?.actualStartTime) {
      return null;
    }
    return Date.now() - new Date(broadcast.actualStartTime).getTime();
  }

  private requireClient(): youtube_v3.Youtube {
    if (!this.youtube) {
      throw new Error('YouTube API client not initialized');
    }
    return this.youtube;
  }
}
