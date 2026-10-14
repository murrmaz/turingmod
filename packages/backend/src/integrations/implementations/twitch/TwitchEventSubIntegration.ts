import {
  IntegrationGroup,
  IntegrationStatus,
  messageOf,
  PermissionLevel,
  StreamingPlatform,
} from '@turingmod/shared';
import type { ApiClient, HelixEventSubSubscriptionStatus, HelixUser } from '@twurple/api';
import type { RefreshingAuthProvider } from '@twurple/auth';
import type { EventSubChannelChatMessageEvent } from '@twurple/eventsub-base';
import { EventSubWsListener } from '@twurple/eventsub-ws';
import { singleton } from 'tsyringe';
import { z } from 'zod';
import { EventBus } from '../../../core/EventBus.js';
import { Logger } from '../../../utils/Logger.js';
import { BaseIntegration } from '../../BaseIntegration.js';
import type { IIntegration } from '../../interfaces/IIntegration.js';
import { TwitchApiIntegration } from './TwitchApiIntegration.js';
import { TwitchAuthIntegration } from './TwitchAuthIntegration.js';

/** The EventSub topics TuringMod can subscribe to. */
export const EventSubTopicSchema = z.enum([
  'channelChatMessage',
  'channelFollow',
  'channelSubscribe',
  'channelRaid',
  'channelCheer',
  'streamOnline',
  'streamOffline',
  'adBreakBegin',
  'channelPointRedemption',
]);

export type EventSubTopic = z.infer<typeof EventSubTopicSchema>;

/**
 * Which topics are on when the saved config doesn't say. A topic is on when something uses it
 * or nearly every streamer wants it: chat, raids (raid shoutouts), ad breaks (stream breaks),
 * redemptions (reward handlers), stream.online (ad warnings re-read the schedule), and follows
 * and subs, which every streamer wants to see and thank. Cheers stay off because they also need
 * `bits:read`, which TWITCH_REQUIRED_SCOPES doesn't request.
 */
export const DEFAULT_EVENTSUB_TOPICS: Readonly<Record<EventSubTopic, boolean>> = {
  channelChatMessage: true,
  channelFollow: true,
  channelSubscribe: true,
  channelRaid: true,
  channelCheer: false,
  streamOnline: true,
  streamOffline: false,
  adBreakBegin: true,
  channelPointRedemption: true,
};

/**
 * Twitch EventSub Configuration
 */
export const TwitchEventSubConfigSchema = z.strictObject({
  /** The channel to listen to. Omitted = the authenticated user's own channel. */
  broadcasterName: z.string().min(1).exactOptional(),
  /** Overrides of DEFAULT_EVENTSUB_TOPICS; a topic left out keeps its default. */
  subscriptions: z.partialRecord(EventSubTopicSchema, z.boolean()).exactOptional(),
});

export type TwitchEventSubConfig = z.infer<typeof TwitchEventSubConfigSchema>;

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
@singleton()
export class TwitchEventSubIntegration extends BaseIntegration {
  readonly name = 'twitch-eventsub';

  private eventSubListener: EventSubWsListener | null = null;
  private config: TwitchEventSubConfig = {};
  private broadcasterId: string | null = null;
  private authProvider: RefreshingAuthProvider | null = null;
  private apiClient: ApiClient | null = null;

  constructor(
    private eventBus: EventBus,
    logger: Logger,
    private authIntegration: TwitchAuthIntegration,
    private apiIntegration: TwitchApiIntegration
  ) {
    super(logger, { component: 'TwitchEventSub' });
  }

  /**
   * Get integration dependencies
   */
  override getDependencies(): IIntegration[] {
    return [this.authIntegration, this.apiIntegration];
  }

  override getGroup(): IntegrationGroup {
    return IntegrationGroup.TWITCH;
  }

  override initialize(stored: unknown): Promise<void> {
    this.config = this.parseConfig(TwitchEventSubConfigSchema, stored);
    return Promise.resolve();
  }

  async start(): Promise<void> {
    this.logger.debug('Starting Twitch EventSub integration');
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
      if (this.config.broadcasterName) {
        const broadcasterName = this.config.broadcasterName;
        const result = await this.apiIntegration.request((c) =>
          c.users.getUserByName(broadcasterName)
        );
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
        const result = await this.apiIntegration.request((c) => c.users.getUserById(userId));
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

      // Fires when Twitch revokes an individual subscription. Most reasons
      // are transport-layer conditions Twurple's own websocket reconnect
      // already handles (websocket_*) or unrelated to auth (moderator_removed,
      // version_removed); only 'authorization_revoked' and 'user_removed'
      // mean the whole OAuth grant is dead and no reconnect will fix it.
      this.eventSubListener.onRevoke((subscription, status) => {
        this.logger.warn(`EventSub subscription revoked: ${subscription.id} (${status})`);
        if (isAuthorizationRevokedStatus(status)) {
          this.setStatus(
            IntegrationStatus.NEEDS_REAUTH,
            'Twitch revoked authorization — re-authorization required'
          );
          // Let TwitchAuthIntegration know independently of its own refresh
          // cycle, since a revoked subscription doesn't necessarily mean the
          // next token refresh attempt will fail on its own.
          this.eventBus.emit('twitch.authorizationRevoked', { reason: status });
        }
      });

      // Start listening
      await this.eventSubListener.start();

      await this.subscribeToEvents(this.config.subscriptions ?? {}, broadcaster.id);

      this.setStatus(IntegrationStatus.CONNECTED);
      this.logger.info('Twitch EventSub integration started successfully');
    } catch (error) {
      this.logger.error('Failed to start Twitch EventSub integration', error);
      this.setStatus(IntegrationStatus.ERROR, messageOf(error));
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.logger.debug('Stopping Twitch EventSub integration');

    if (this.eventSubListener) {
      await this.eventSubListener.stop();
      this.eventSubListener = null;
    }

    this.authProvider = null;
    this.apiClient = null;
    this.broadcasterId = null;
    this.setStatus(IntegrationStatus.DISCONNECTED);

    this.logger.debug('Twitch EventSub integration stopped');
  }

  /**
   * Get the resolved broadcaster ID (available after start)
   */
  getBroadcasterId(): string | null {
    return this.broadcasterId;
  }

  /**
   * Subscribe to the default topics, as overridden by the stored config
   */
  private async subscribeToEvents(
    overrides: Partial<Record<EventSubTopic, boolean>>,
    broadcasterId: string
  ): Promise<void> {
    if (!this.eventSubListener) return;

    const subscriptions = { ...DEFAULT_EVENTSUB_TOPICS, ...overrides };

    // Channel Chat Message (for commands and chat)
    if (subscriptions.channelChatMessage) {
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

    // Channel Cheer. Turning it on also needs `bits:read` added to TWITCH_REQUIRED_SCOPES.
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
        this.eventBus.emit('twitch.channelPoint.redemption', {
          id: event.id,
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

    // OwnChatMessages republishes this as `chat.message`, minus TuringMod's own messages.
    // Commands are parsed out by ChatRouter, after moderation.
    this.eventBus.emit('chat.received', {
      platform: StreamingPlatform.TWITCH,
      platformUserId: event.chatterId,
      username: event.chatterDisplayName,
      message: event.messageText,
      permissionLevel,
      badges: badgeNames,
      timestamp: Date.now(),
      messageId: event.messageId,
      channelId: event.broadcasterId,
      channelName: event.broadcasterName,
    });
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

/**
 * Whether an EventSub subscription revocation means the whole OAuth grant is
 * dead, rather than a transport-layer condition Twurple's websocket reconnect
 * logic already manages, or an unrelated change (e.g. a moderator losing the
 * role that backed the subscription).
 */
function isAuthorizationRevokedStatus(status: HelixEventSubSubscriptionStatus): boolean {
  return status === 'authorization_revoked' || status === 'user_removed';
}
