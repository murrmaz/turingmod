import { IntegrationStatus, PermissionLevel, Platform } from '@turingmod/shared';
import type { youtube_v3 } from 'googleapis';
import type { EventBus } from '../../core/EventBus.js';
import type { Logger } from '../../utils/Logger.js';
import { BaseIntegration } from '../BaseIntegration.js';
import type { YouTubeApiIntegration } from './YouTubeApiIntegration.js';
import type { YouTubeAuthIntegration } from './YouTubeAuthIntegration.js';

/** How long to wait before re-checking for an active broadcast while idle (offline). */
const IDLE_POLL_INTERVAL_MS = 30_000;
/** Fallback poll interval if the API doesn't return pollingIntervalMillis. */
const DEFAULT_POLL_INTERVAL_MS = 5_000;

/**
 * YouTube Chat Integration
 * Polls the active broadcast's live chat and normalizes each message into the same `chat.message`
 * / `chat.command` EventBus events Twitch emits, so the (deferred) ChatRouter is platform-agnostic.
 *
 * The liveChatId is only available while a broadcast is active, so this idles gracefully when
 * offline and re-resolves the chat id on each new stream (see multi-platform-chat.md §11).
 *
 * Depends on: YouTubeAuthIntegration, YouTubeApiIntegration
 */
export class YouTubeChatIntegration extends BaseIntegration {
  readonly name = 'youtube-chat';
  readonly version = '1.0.0';

  private liveChatId: string | null = null;
  private broadcasterChannelId: string | null = null;
  private nextPageToken: string | undefined;
  private pollTimer: NodeJS.Timeout | null = null;
  private running = false;
  // Skip the first page of chat history so we don't replay old messages as fresh commands.
  private primed = false;

  constructor(
    private eventBus: EventBus,
    logger: Logger,
    private authIntegration: YouTubeAuthIntegration,
    private apiIntegration: YouTubeApiIntegration
  ) {
    super(logger, { component: 'YouTubeChat' });
  }

  getDependencies(): string[] {
    return ['youtube-auth', 'youtube-api'];
  }

  initialize(_config: Record<string, unknown>): Promise<void> {
    this.logger.info('YouTube Chat integration initialized (no config needed)');
    return Promise.resolve();
  }

  start(): Promise<void> {
    this.logger.info('Starting YouTube Chat integration');
    this.setStatus(IntegrationStatus.CONNECTING);

    if (!this.authIntegration.getAuthClient()) {
      throw new Error('YouTubeAuthIntegration must be started (and authorized) first');
    }

    this.running = true;
    this.setStatus(IntegrationStatus.CONNECTED);
    this.logger.info('YouTube Chat integration started; polling for an active broadcast');

    this.scheduleNextPoll(0);
    return Promise.resolve();
  }

  stop(): Promise<void> {
    this.logger.info('Stopping YouTube Chat integration');

    this.running = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    this.resetBroadcast();
    this.setStatus(IntegrationStatus.DISCONNECTED);

    this.logger.info('YouTube Chat integration stopped');
    return Promise.resolve();
  }

  private scheduleNextPoll(delayMs: number): void {
    if (!this.running) {
      return;
    }
    this.pollTimer = setTimeout(() => {
      void this.poll();
    }, delayMs);
  }

  /**
   * One poll tick: resolve the live chat if needed, fetch the next page of messages, emit events,
   * and schedule the next tick using the interval YouTube recommends.
   */
  private async poll(): Promise<void> {
    if (!this.running) {
      return;
    }

    try {
      if (!this.liveChatId) {
        const resolved = await this.resolveLiveChat();
        if (!resolved) {
          this.scheduleNextPoll(IDLE_POLL_INTERVAL_MS);
          return;
        }
      }

      const liveChatId = this.liveChatId;
      if (!liveChatId) {
        this.scheduleNextPoll(IDLE_POLL_INTERVAL_MS);
        return;
      }

      const page = await this.apiIntegration.listLiveChatMessages(liveChatId, this.nextPageToken);

      // The first page is chat backlog — record the cursor but don't replay it as new activity.
      if (this.primed) {
        for (const item of page.items ?? []) {
          this.handleMessage(item);
        }
      } else {
        this.primed = true;
      }

      this.nextPageToken = page.nextPageToken ?? undefined;
      this.scheduleNextPoll(page.pollingIntervalMillis ?? DEFAULT_POLL_INTERVAL_MS);
    } catch (error) {
      // A broadcast ending typically surfaces as an API error; drop the chat id and idle until a
      // new stream appears.
      this.logger.warn('YouTube chat poll failed; will re-resolve active broadcast', error);
      this.resetBroadcast();
      this.scheduleNextPoll(IDLE_POLL_INTERVAL_MS);
    }
  }

  /** Resolve the active broadcast's live chat id, returning false when offline. */
  private async resolveLiveChat(): Promise<boolean> {
    const broadcast = await this.apiIntegration.getActiveBroadcast();
    if (!broadcast?.liveChatId) {
      this.resetBroadcast();
      return false;
    }

    this.liveChatId = broadcast.liveChatId;
    this.broadcasterChannelId = broadcast.channelId;
    this.nextPageToken = undefined;
    this.primed = false;
    this.logger.info('Resolved active YouTube live chat', { liveChatId: broadcast.liveChatId });
    return true;
  }

  private resetBroadcast(): void {
    this.liveChatId = null;
    this.broadcasterChannelId = null;
    this.nextPageToken = undefined;
    this.primed = false;
  }

  /**
   * Normalize one live chat message into `chat.message` (+ `chat.command` for `!`-prefixed text).
   * Payloads mirror TwitchEventSubIntegration.handleChatMessage() exactly.
   */
  private handleMessage(item: youtube_v3.Schema$LiveChatMessage): void {
    const author = item.authorDetails;
    const snippet = item.snippet;
    const messageText = snippet?.displayMessage ?? snippet?.textMessageDetails?.messageText ?? '';

    if (!(author && messageText)) {
      return;
    }

    const platformUserId = author.channelId ?? '';
    const username = author.displayName ?? '';
    const permissionLevel = this.getPermissionFromAuthor(author);
    const badges = this.getBadgesFromAuthor(author);

    this.logger.debug('YouTube chat message received', { user: username, message: messageText });

    this.eventBus.emit('chat.message', {
      platform: Platform.YOUTUBE,
      platformUserId,
      username,
      message: messageText,
      permissionLevel,
      badges,
      timestamp: Date.now(),
    });

    // Check if message is a command (starts with !)
    if (messageText.startsWith('!')) {
      const parts = messageText.slice(1).split(' ');
      const commandName = parts[0] || '';
      const args = parts;

      this.eventBus.emit('chat.command', {
        command: commandName,
        args,
        user: {
          id: platformUserId,
          platform: Platform.YOUTUBE,
          platformUserId,
          username,
          permissionLevel,
        },
        platform: Platform.YOUTUBE,
        metadata: {
          badges,
          channelId: this.broadcasterChannelId,
        },
      });
    }
  }

  /**
   * Map YouTube author roles to a PermissionLevel. Role mapping is lossy: YouTube has no VIP
   * equivalent, and a channel "member" (sponsor) is treated as a subscriber.
   */
  private getPermissionFromAuthor(
    author: youtube_v3.Schema$LiveChatMessageAuthorDetails
  ): PermissionLevel {
    if (author.isChatOwner) return PermissionLevel.BROADCASTER;
    if (author.isChatModerator) return PermissionLevel.MODERATOR;
    if (author.isChatSponsor) return PermissionLevel.SUBSCRIBER;
    return PermissionLevel.VIEWER;
  }

  /** Derive Twitch-badge-style role markers from YouTube author flags (parity only). */
  private getBadgesFromAuthor(author: youtube_v3.Schema$LiveChatMessageAuthorDetails): string[] {
    const badges: string[] = [];
    if (author.isChatOwner) badges.push('owner');
    if (author.isChatModerator) badges.push('moderator');
    if (author.isChatSponsor) badges.push('sponsor');
    if (author.isVerified) badges.push('verified');
    return badges;
  }
}
