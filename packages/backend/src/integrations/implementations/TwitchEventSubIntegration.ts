import { IntegrationStatus, PermissionLevel } from '@turingmod/shared';
import type { ApiClient, HelixUser } from '@twurple/api';
import type { RefreshingAuthProvider } from '@twurple/auth';
import type { EventSubChannelChatMessageEvent } from '@twurple/eventsub-base';
import { EventSubWsListener } from '@twurple/eventsub-ws';
import type { EventBus } from '../../core/EventBus.js';
import type { Logger } from '../../utils/Logger.js';
import { BaseIntegration } from '../BaseIntegration.js';
import type { TwitchApiIntegration } from './TwitchApiIntegration.js';
import type { TwitchAuthIntegration } from './TwitchAuthIntegration.js';

/**
 * Twitch EventSub Configuration
 */
export interface TwitchEventSubConfig {
  broadcasterName: string;
  subscriptions: {
    channelChatMessage?: boolean;
    channelFollow?: boolean;
    channelSubscribe?: boolean;
    channelRaid?: boolean;
    channelCheer?: boolean;
    streamOnline?: boolean;
    streamOffline?: boolean;
    adBreakBegin?: boolean;
    channelPointRedemption?: boolean;
  };
}

/**
 * Twitch EventSub Integration
 * Handles real-time events via EventSub WebSocket
 *
 * Responsibilities:
 * - Subscribing to EventSub events
 * - Processing incoming events
 * - Emitting events to EventBus
 * - Handling chat messages and commands
 *
 * Depends on: TwitchAuthIntegration, TwitchApiIntegration
 */
export class TwitchEventSubIntegration extends BaseIntegration {
  readonly name = 'twitch-eventsub';
  readonly version = '1.0.0';

  private eventSubListener: EventSubWsListener | null = null;
  private config: TwitchEventSubConfig | null = null;
  private broadcasterId: string | null = null;
  private authProvider: RefreshingAuthProvider | null = null;
  private apiClient: ApiClient | null = null;

  constructor(
    private eventBus: EventBus,
    logger: Logger,
    private authIntegration: TwitchAuthIntegration,
    private apiIntegration: TwitchApiIntegration
  ) {
    super(logger, { integration: 'TwitchEventSub' });
  }

  /**
   * Get integration dependencies
   */
  getDependencies(): string[] {
    return ['twitch-auth', 'twitch-api'];
  }

  initialize(config: Record<string, unknown>): Promise<void> {
    this.logger.info('Initializing Twitch EventSub integration');

    this.config = config as unknown as TwitchEventSubConfig;

    // Validate config
    if (!this.config.broadcasterName) {
      throw new Error('broadcasterName is required');
    }

    this.logger.info('Twitch EventSub integration initialized');
    return Promise.resolve();
  }

  async start(): Promise<void> {
    this.logger.info('Starting Twitch EventSub integration');
    this.setStatus(IntegrationStatus.CONNECTING);

    try {
      // Get auth provider and API client from dependencies
      this.authProvider = this.authIntegration.getAuthProvider();
      this.apiClient = this.apiIntegration.getApiClient();

      if (!this.authProvider) {
        throw new Error('TwitchAuthIntegration must be started first');
      }
      if (!this.apiClient) {
        throw new Error('TwitchApiIntegration must be started first');
      }

      // Get broadcaster user - use config if available, otherwise resolve from authenticated user
      let broadcaster: HelixUser;
      if (this.config?.broadcasterName) {
        const result = await this.apiClient.users.getUserByName(this.config.broadcasterName);
        if (!result) {
          throw new Error(`Broadcaster not found: ${this.config.broadcasterName}`);
        }
        broadcaster = result;
      } else {
        // Derive broadcaster from the authenticated user (the bot owner)
        const userId = this.authIntegration.getAuthenticatedUserId();
        if (!userId) {
          throw new Error('Could not determine authenticated user from auth provider');
        }
        const result = await this.apiClient.users.getUserById(userId);
        if (!result) {
          throw new Error('Could not resolve authenticated user');
        }
        broadcaster = result;
      }

      this.broadcasterId = broadcaster.id;
      this.logger.info(`Found broadcaster: ${broadcaster.displayName} (${broadcaster.id})`);

      // Create EventSub WebSocket listener
      this.eventSubListener = new EventSubWsListener({
        apiClient: this.apiClient,
      });

      // Start listening
      await this.eventSubListener.start();

      // Build subscription config from saved config or use defaults
      const subscriptionConfig: TwitchEventSubConfig = this.config ?? {
        broadcasterName: broadcaster.name,
        subscriptions: {},
      };

      // Subscribe to configured events
      await this.subscribeToEvents(subscriptionConfig, broadcaster.id);

      this.setStatus(IntegrationStatus.CONNECTED);
      this.logger.info('Twitch EventSub integration started successfully');
    } catch (error) {
      this.logger.error('Failed to start Twitch EventSub integration', error);
      this.setStatus(
        IntegrationStatus.ERROR,
        error instanceof Error ? error.message : 'Unknown error'
      );
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.logger.info('Stopping Twitch EventSub integration');

    if (this.eventSubListener) {
      await this.eventSubListener.stop();
      this.eventSubListener = null;
    }

    this.authProvider = null;
    this.apiClient = null;
    this.broadcasterId = null;
    this.setStatus(IntegrationStatus.DISCONNECTED);

    this.logger.info('Twitch EventSub integration stopped');
  }

  /**
   * Get the resolved broadcaster ID (available after start)
   */
  getBroadcasterId(): string | null {
    return this.broadcasterId;
  }

  /**
   * Subscribe to EventSub events based on configuration
   */
  private async subscribeToEvents(
    config: TwitchEventSubConfig,
    broadcasterId: string
  ): Promise<void> {
    if (!this.eventSubListener) return;

    const subscriptions = config.subscriptions || {};

    // Channel Chat Message (for commands and chat)
    if (subscriptions.channelChatMessage !== false) {
      await this.eventSubListener.onChannelChatMessage(broadcasterId, broadcasterId, (event) => {
        this.handleChatMessage(event);
      });
      this.logger.info('Subscribed to channel.chat.message');
    }

    // Channel Follow
    if (subscriptions.channelFollow) {
      await this.eventSubListener.onChannelFollow(broadcasterId, broadcasterId, (event) => {
        this.eventBus.emit('twitch.follow', {
          userId: event.userId,
          userName: event.userName,
          userDisplayName: event.userDisplayName,
          followDate: event.followDate,
        });
      });
      this.logger.info('Subscribed to channel.follow');
    }

    // Channel Subscribe
    if (subscriptions.channelSubscribe) {
      await this.eventSubListener.onChannelSubscription(broadcasterId, (event) => {
        this.eventBus.emit('twitch.subscribe', {
          userId: event.userId,
          userName: event.userName,
          userDisplayName: event.userDisplayName,
          tier: event.tier,
          isGift: event.isGift,
        });
      });
      this.logger.info('Subscribed to channel.subscribe');
    }

    // Channel Raid
    if (subscriptions.channelRaid) {
      await this.eventSubListener.onChannelRaidTo(broadcasterId, (event) => {
        this.eventBus.emit('twitch.raid', {
          fromBroadcasterId: event.raidingBroadcasterId,
          fromBroadcasterName: event.raidingBroadcasterName,
          fromBroadcasterDisplayName: event.raidingBroadcasterDisplayName,
          viewers: event.viewers,
        });
      });
      this.logger.info('Subscribed to channel.raid');
    }

    // Channel Cheer
    if (subscriptions.channelCheer) {
      await this.eventSubListener.onChannelCheer(broadcasterId, (event) => {
        this.eventBus.emit('twitch.cheer', {
          userId: event.userId,
          userName: event.userName,
          userDisplayName: event.userDisplayName,
          bits: event.bits,
          message: event.message,
        });
      });
      this.logger.info('Subscribed to channel.cheer');
    }

    // Stream Online
    if (subscriptions.streamOnline) {
      await this.eventSubListener.onStreamOnline(broadcasterId, (event) => {
        this.eventBus.emit('twitch.stream.online', {
          broadcasterId: event.broadcasterId,
          broadcasterName: event.broadcasterName,
          broadcasterDisplayName: event.broadcasterDisplayName,
          startedAt: event.startDate,
        });
      });
      this.logger.info('Subscribed to stream.online');
    }

    // Stream Offline
    if (subscriptions.streamOffline) {
      await this.eventSubListener.onStreamOffline(broadcasterId, (event) => {
        this.eventBus.emit('twitch.stream.offline', {
          broadcasterId: event.broadcasterId,
          broadcasterName: event.broadcasterName,
          broadcasterDisplayName: event.broadcasterDisplayName,
        });
      });
      this.logger.info('Subscribed to stream.offline');
    }

    // Ad Break Begin
    if (subscriptions.adBreakBegin) {
      await this.eventSubListener.onChannelAdBreakBegin(broadcasterId, (event) => {
        this.eventBus.emit('twitch.ad.break', {
          durationSeconds: event.durationSeconds,
          startedAt: event.startDate,
          isAutomatic: event.isAutomatic,
          broadcasterId: event.broadcasterId,
          broadcasterName: event.broadcasterName,
          broadcasterDisplayName: event.broadcasterDisplayName,
        });
      });
      this.logger.info('Subscribed to channel.ad_break.begin');
    }

    // Channel Point Redemption
    if (subscriptions.channelPointRedemption) {
      await this.eventSubListener.onChannelRedemptionAdd(broadcasterId, (event) => {
        this.eventBus.emit('twitch.channelpoint.redemption', {
          userId: event.userId,
          userName: event.userName,
          userDisplayName: event.userDisplayName,
          rewardId: event.rewardId,
          rewardTitle: event.rewardTitle,
          rewardCost: event.rewardCost,
          input: event.input,
          status: event.status,
          redeemedAt: event.redemptionDate,
        });
      });
      this.logger.info('Subscribed to channel.channel_points_custom_reward_redemption.add');
    }
  }

  /**
   * Handle incoming chat message
   */
  private handleChatMessage(event: EventSubChannelChatMessageEvent): void {
    this.logger.debug('Chat message received', {
      user: event.chatterDisplayName,
      message: event.messageText,
    });

    // Parse permission level from badges
    const isBroadcaster = event.broadcasterId === event.chatterId;
    const badgeNames = Object.keys(event.badges);
    const permissionLevel = this.getPermissionFromBadges(badgeNames, isBroadcaster);

    // Emit chat message event
    this.eventBus.emit('chat.message', {
      platform: 'twitch',
      platformUserId: event.chatterId,
      username: event.chatterDisplayName,
      message: event.messageText,
      permissionLevel,
      badges: badgeNames,
      timestamp: Date.now(),
    });

    // Check if message is a command (starts with !)
    if (event.messageText.startsWith('!')) {
      const parts = event.messageText.slice(1).split(' ');
      const commandName = parts[0] || '';
      const args = parts;

      this.eventBus.emit('chat.command', {
        command: commandName,
        args,
        user: {
          id: event.chatterId,
          platform: 'twitch',
          platformUserId: event.chatterId,
          username: event.chatterDisplayName,
          permissionLevel,
        },
        platform: 'twitch',
        metadata: {
          badges: badgeNames,
          channelId: event.broadcasterId,
        },
      });
    }
  }

  /**
   * Get permission level from Twitch badges
   */
  private getPermissionFromBadges(badgeNames: string[], isBroadcaster: boolean): PermissionLevel {
    if (isBroadcaster) return PermissionLevel.BROADCASTER;

    if (badgeNames.includes('moderator')) return PermissionLevel.MODERATOR;
    if (badgeNames.includes('vip')) return PermissionLevel.VIP;
    if (badgeNames.includes('subscriber')) return PermissionLevel.SUBSCRIBER;

    return PermissionLevel.VIEWER;
  }
}
