import { EventEmitter } from 'node:events';
import { IntegrationStatus } from '@turingmod/shared';
import { ApiClient } from '@twurple/api';
import type { RefreshingAuthProvider } from '@twurple/auth';
import type { EventBus } from '../../core/EventBus.js';
import type { Logger } from '../../utils/Logger.js';
import type { IIntegration } from '../interfaces/IIntegration.js';
import type { TwitchAuthIntegration } from './TwitchAuthIntegration.js';

/**
 * Twitch API Configuration
 */
export type TwitchApiConfig = Record<string, unknown>;

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
export class TwitchApiIntegration implements IIntegration {
  readonly name = 'twitch-api';
  readonly version = '1.0.0';

  private status: IntegrationStatus = IntegrationStatus.DISCONNECTED;
  private errorMessage: string | undefined;
  private apiClient: ApiClient | null = null;
  private events = new EventEmitter();
  private logger: Logger;
  private authProvider: RefreshingAuthProvider | null = null;

  constructor(
    private eventBus: EventBus,
    logger: Logger,
    private authIntegration: TwitchAuthIntegration
  ) {
    this.logger = logger.child({ integration: 'TwitchAPI' });
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
    this.setStatus(IntegrationStatus.DISCONNECTED);

    this.logger.info('Twitch API integration stopped');
    return Promise.resolve();
  }

  getStatus(): IntegrationStatus {
    return this.status;
  }

  getErrorMessage(): string | undefined {
    return this.errorMessage;
  }

  on(event: string, handler: (...args: unknown[]) => void): void {
    this.events.on(event, handler);
  }

  off(event: string, handler: (...args: unknown[]) => void): void {
    this.events.off(event, handler);
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

  /**
   * Set integration status and emit event
   */
  private setStatus(status: IntegrationStatus, errorMessage?: string): void {
    this.status = status;
    this.errorMessage = status === IntegrationStatus.ERROR ? errorMessage : undefined;
    this.events.emit('status', status);
    this.eventBus.emit('integration.status', {
      name: this.name,
      status,
      lastConnected: status === IntegrationStatus.CONNECTED ? Date.now() : undefined,
      errorMessage: this.errorMessage,
    });
  }
}
