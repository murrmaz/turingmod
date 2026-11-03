import {
  type IntegrationGroup,
  IntegrationName,
  IntegrationStatus,
  messageOf,
  PermissionLevel,
  StreamingPlatform,
} from '@turingmod/shared';
import type { HelixEventSubSubscriptionStatus } from '@twurple/api';
import type { EventSubChannelChatMessageEvent, EventSubSubscription } from '@twurple/eventsub-base';
import { EventSubWsListener } from '@twurple/eventsub-ws';
import { singleton } from 'tsyringe';
import { z } from 'zod';
import { EventBus } from '../../../core/EventBus.js';
import { Logger } from '../../../utils/Logger.js';
import { BaseIntegration } from '../../BaseIntegration.js';
import type { IIntegration } from '../../interfaces/IIntegration.js';
import { TwitchApiIntegration } from './TwitchApiIntegration.js';
import { TwitchAuthIntegration } from './TwitchAuthIntegration.js';
import { TWITCH_GROUP } from './twitchGroup.js';

/** The EventSub topics TuringMod can subscribe to. */
export const EventSubTopicSchema = z.enum([
  'channelChatMessage',
  'channelFollow',
  'channelSubscribe',
  'channelRaid',
  'channelCheer',
  'streamOnline',
  'streamOffline',
  'channelUpdate',
  'adBreakBegin',
  'channelPointRedemption',
]);

export type EventSubTopic = z.infer<typeof EventSubTopicSchema>;

/**
 * Which topics are on when the saved config doesn't say. A topic is on when something uses it
 * or nearly every streamer wants it: chat, raids (raid shoutouts), ad breaks (stream breaks),
 * redemptions (reward handlers), stream.online and stream.offline (live state, the Discord go-live
 * post, and ad warnings re-reading the schedule), channel.update (a title or category change made
 * anywhere, for the Discord go-live post), and follows
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
  streamOffline: true,
  channelUpdate: true,
  adBreakBegin: true,
  channelPointRedemption: true,
};

/**
 * Twitch EventSub Configuration
 */
export const TwitchEventSubConfigSchema = z.strictObject({
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
 * Twurple's on<Topic>() calls return at once and ask Twitch later, once the socket is open and again
 * each time it reopens. A refused request is never retried, and nothing throws. So this reports
 * CONNECTING until Twitch has accepted every topic, then CONNECTED, and ERROR as soon as it refuses
 * any, naming them: a topic that didn't subscribe is an event that never arrives, which
 * looks exactly like a quiet stream. The topics that were accepted keep running through that ERROR.
 *
 * Depends on: TwitchAuthIntegration, TwitchApiIntegration
 */
@singleton()
export class TwitchEventSubIntegration extends BaseIntegration {
  readonly name = IntegrationName.TWITCH_EVENTSUB;

  private eventSubListener: EventSubWsListener | null = null;
  private config: TwitchEventSubConfig = {};
  /** Every subscription on the current listener: Twurple's id for it, and the topic it's for. */
  private topics = new Map<string, string>();
  /** Those Twitch hasn't answered for yet, since the listener started or the socket last dropped. */
  private pending = new Set<string>();
  /** Those Twitch refused since then: the topic, and why. */
  private refused = new Map<string, string>();

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
    return TWITCH_GROUP;
  }

  override initialize(stored: unknown): Promise<void> {
    this.config = this.parseConfig(TwitchEventSubConfigSchema, stored);
    return Promise.resolve();
  }

  async start(): Promise<void> {
    this.logger.debug('Starting Twitch EventSub integration');
    this.setStatus(IntegrationStatus.CONNECTING, 'Subscribing to Twitch events');
    // A retry after ERROR comes here without a stop(), and the old listener would deliver every
    // event a second time.
    this.closeListener();

    try {
      // Get auth provider and API client from dependencies
      const apiClient = this.apiIntegration.getApiClient();
      if (!this.authIntegration.getAuthProvider()) {
        throw new Error('TwitchAuthIntegration must be started first');
      }
      if (!apiClient) {
        throw new Error('TwitchApiIntegration must be started first');
      }

      // Always the authenticated user's own channel: chat is subscribed to with the broadcaster's
      // id as the reading user too, and TuringMod posts as the broadcaster.
      const userId = this.authIntegration.getAuthenticatedUserId();
      if (!userId) {
        throw new Error('Could not determine authenticated user from auth provider');
      }
      const broadcaster = await this.apiIntegration.request((c) => c.users.getUserById(userId));
      if (!broadcaster) {
        throw new Error('Could not resolve authenticated user');
      }

      this.logger.info(`Found broadcaster: ${broadcaster.displayName} (${broadcaster.id})`);

      // Create EventSub WebSocket listener
      const listener = new EventSubWsListener({
        apiClient,
      });
      this.eventSubListener = listener;

      // Fires when Twitch revokes an individual subscription. Most reasons
      // are transport-layer conditions Twurple's own websocket reconnect
      // already handles (websocket_*) or unrelated to auth (moderator_removed,
      // version_removed); only 'authorization_revoked' and 'user_removed'
      // mean the whole OAuth grant is dead and no reconnect will fix it.
      listener.onRevoke((subscription, status) => {
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

      listener.onUserSocketReady((_userId, sessionId) => {
        this.eventBus.emit('twitch.eventSub.ready', { sessionId });
      });
      listener.onSubscriptionCreateSuccess((subscription) => {
        if (listener === this.eventSubListener) {
          this.onSubscriptionAccepted(subscription);
        }
      });
      listener.onSubscriptionCreateFailure((subscription, error) => {
        if (listener === this.eventSubListener) {
          this.onSubscriptionRefused(subscription, error);
        }
      });
      listener.onUserSocketDisconnect(() => {
        if (listener === this.eventSubListener) {
          this.onSocketLost();
        }
      });

      // Start listening
      listener.start();

      this.subscribeToEvents(listener, this.config.subscriptions ?? {}, broadcaster.id);
      this.reportSubscriptions(); // every topic turned off leaves nothing to wait for
    } catch (error) {
      this.logger.error('Failed to start Twitch EventSub integration', error);
      this.setStatus(IntegrationStatus.ERROR, messageOf(error));
      throw error;
    }
  }

  stop(): Promise<void> {
    this.logger.debug('Stopping Twitch EventSub integration');

    this.closeListener();
    this.setStatus(IntegrationStatus.DISCONNECTED);

    this.logger.debug('Twitch EventSub integration stopped');
    return Promise.resolve();
  }

  /** Cleared before it stops, so what stopping it fires is recognized as no longer current. */
  private closeListener(): void {
    const listener = this.eventSubListener;
    this.eventSubListener = null;
    this.topics.clear();
    this.pending.clear();
    this.refused.clear();
    listener?.stop();
  }

  private onSubscriptionAccepted(subscription: EventSubSubscription): void {
    this.logger.info(`Subscribed to ${this.topics.get(subscription.id)}`);
    this.pending.delete(subscription.id);
    this.reportSubscriptions();
  }

  private onSubscriptionRefused(subscription: EventSubSubscription, error: Error): void {
    const topic = this.topics.get(subscription.id) ?? subscription.id;
    this.logger.error(`Could not subscribe to ${topic}`, error);
    this.pending.delete(subscription.id);
    this.refused.set(topic, messageOf(error));
    this.reportSubscriptions();
  }

  /**
   * Twitch ends a socket's subscriptions with it, and Twurple asks for all of them again on the next
   * one, refused topics included. This fires for every failed attempt to reconnect, too.
   */
  private onSocketLost(): void {
    this.pending = new Set(this.topics.keys());
    this.refused.clear();
    if (
      this.status !== IntegrationStatus.CONNECTING &&
      this.status !== IntegrationStatus.NEEDS_REAUTH
    ) {
      this.logger.warn('Lost the EventSub connection; reconnecting');
      this.setStatus(IntegrationStatus.CONNECTING, 'Lost the connection to Twitch; reconnecting');
    }
  }

  /**
   * A refusal is reported at once, without waiting for the other topics: Twurple's rate limiter holds
   * the rest of its queue after a failed request or one without rate limit headers, until something
   * else calls the API, so their answers may be a long time coming.
   */
  private reportSubscriptions(): void {
    if (this.status === IntegrationStatus.NEEDS_REAUTH) {
      return;
    }
    if (this.refused.size > 0) {
      const description = describeRefusals(this.refused);
      if (this.status !== IntegrationStatus.ERROR || this.getErrorMessage() !== description) {
        this.setStatus(IntegrationStatus.ERROR, description);
      }
    } else if (this.pending.size === 0 && this.status !== IntegrationStatus.CONNECTED) {
      this.setStatus(IntegrationStatus.CONNECTED);
      this.logger.info('Twitch EventSub integration started successfully');
    }
  }

  private track(topic: string, subscription: EventSubSubscription): void {
    this.topics.set(subscription.id, topic);
    this.pending.add(subscription.id);
  }

  /**
   * Subscribe to the default topics, as overridden by the stored config
   */
  private subscribeToEvents(
    listener: EventSubWsListener,
    overrides: Partial<Record<EventSubTopic, boolean>>,
    broadcasterId: string
  ): void {
    const subscriptions = { ...DEFAULT_EVENTSUB_TOPICS, ...overrides };

    // Channel Chat Message (for commands and chat)
    if (subscriptions.channelChatMessage) {
      this.track(
        'channel.chat.message',
        listener.onChannelChatMessage(broadcasterId, broadcasterId, (event) => {
          this.handleChatMessage(event);
        })
      );
    }

    // Channel Follow
    if (subscriptions.channelFollow) {
      this.track(
        'channel.follow',
        listener.onChannelFollow(broadcasterId, broadcasterId, (event) => {
          this.eventBus.emit('twitch.follow', {
            userId: event.userId,
            userName: event.userName,
            userDisplayName: event.userDisplayName,
            followDate: event.followDate,
          });
        })
      );
    }

    // Channel Subscribe
    if (subscriptions.channelSubscribe) {
      this.track(
        'channel.subscribe',
        listener.onChannelSubscription(broadcasterId, (event) => {
          this.eventBus.emit('twitch.subscribe', {
            userId: event.userId,
            userName: event.userName,
            userDisplayName: event.userDisplayName,
            tier: event.tier,
            isGift: event.isGift,
          });
        })
      );
    }

    // Channel Raid
    if (subscriptions.channelRaid) {
      this.track(
        'channel.raid',
        listener.onChannelRaidTo(broadcasterId, (event) => {
          this.eventBus.emit('twitch.raid', {
            fromBroadcasterId: event.raidingBroadcasterId,
            fromBroadcasterName: event.raidingBroadcasterName,
            fromBroadcasterDisplayName: event.raidingBroadcasterDisplayName,
            viewers: event.viewers,
          });
        })
      );
    }

    // Channel Cheer. Turning it on also needs `bits:read` added to TWITCH_REQUIRED_SCOPES.
    if (subscriptions.channelCheer) {
      this.track(
        'channel.cheer',
        listener.onChannelCheer(broadcasterId, (event) => {
          this.eventBus.emit('twitch.cheer', {
            userId: event.userId,
            userName: event.userName,
            userDisplayName: event.userDisplayName,
            bits: event.bits,
            message: event.message,
          });
        })
      );
    }

    // Stream Online
    if (subscriptions.streamOnline) {
      this.track(
        'stream.online',
        listener.onStreamOnline(broadcasterId, (event) => {
          this.eventBus.emit('twitch.stream.online', {
            broadcasterId: event.broadcasterId,
            broadcasterName: event.broadcasterName,
            broadcasterDisplayName: event.broadcasterDisplayName,
            startedAt: event.startDate,
          });
        })
      );
    }

    // Stream Offline
    if (subscriptions.streamOffline) {
      this.track(
        'stream.offline',
        listener.onStreamOffline(broadcasterId, (event) => {
          this.eventBus.emit('twitch.stream.offline', {
            broadcasterId: event.broadcasterId,
            broadcasterName: event.broadcasterName,
            broadcasterDisplayName: event.broadcasterDisplayName,
          });
        })
      );
    }

    // Channel Update: a title or category change, from TuringMod or anywhere else (the dashboard).
    if (subscriptions.channelUpdate) {
      this.track(
        'channel.update',
        listener.onChannelUpdate(broadcasterId, () => {
          this.eventBus.emit('stream.info.changed', { platforms: [StreamingPlatform.TWITCH] });
        })
      );
    }

    // Ad Break Begin
    if (subscriptions.adBreakBegin) {
      this.track(
        'channel.ad_break.begin',
        listener.onChannelAdBreakBegin(broadcasterId, (event) => {
          this.eventBus.emit('twitch.ad.break', {
            durationSeconds: event.durationSeconds,
            startedAt: event.startDate,
            isAutomatic: event.isAutomatic,
            broadcasterId: event.broadcasterId,
            broadcasterName: event.broadcasterName,
            broadcasterDisplayName: event.broadcasterDisplayName,
          });
        })
      );
    }

    // Channel Point Redemption
    if (subscriptions.channelPointRedemption) {
      this.track(
        'channel.channel_points_custom_reward_redemption.add',
        listener.onChannelRedemptionAdd(broadcasterId, (event) => {
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
        })
      );
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
    const permissionLevel = isBroadcaster
      ? PermissionLevel.BROADCASTER
      : permissionFromBadges(badgeNames);

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
}

/** "topic, topic: why; topic: why", with the topics refused for one reason together. */
function describeRefusals(refused: ReadonlyMap<string, string>): string {
  const topicsByReason = new Map<string, string[]>();
  for (const [topic, reason] of refused) {
    topicsByReason.set(reason, [...(topicsByReason.get(reason) ?? []), topic]);
  }
  const parts = [...topicsByReason].map(([reason, topics]) => `${topics.join(', ')}: ${reason}`);
  return `Twitch refused these event subscriptions, so those events won't arrive. ${parts.join('; ')}`;
}

/**
 * A chatter's permission from the badges on their message. Twitch shows one badge per role, so
 * some roles arrive under another name: a lead moderator wears `lead_moderator` instead of
 * `moderator`, and one of a channel's first subscribers `founder` instead of `subscriber`.
 */
export function permissionFromBadges(badgeNames: readonly string[]): PermissionLevel {
  const has = (...names: string[]) => names.some((name) => badgeNames.includes(name));

  if (has('moderator', 'lead_moderator')) return PermissionLevel.MODERATOR;
  if (has('vip')) return PermissionLevel.VIP;
  if (has('subscriber', 'founder')) return PermissionLevel.SUBSCRIBER;

  return PermissionLevel.VIEWER;
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
