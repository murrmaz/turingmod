import { IntegrationGroup, IntegrationStatus, messageOf } from '@turingmod/shared';
import { google, type youtube_v3 } from 'googleapis';
import { injectable, singleton } from 'tsyringe';
import { Logger } from '../../../utils/Logger.js';
import { BaseIntegration } from '../../BaseIntegration.js';
import { DependencyFailurePolicy, type IIntegration } from '../../interfaces/IIntegration.js';
import { YouTubeAuthIntegration, type YouTubeOAuth2Client } from './YouTubeAuthIntegration.js';

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
 * The fields of a broadcast that don't change while it's live, so they can be held for its
 * lifetime. The title is left out: it can be changed mid-stream, in YouTube Studio or by `!title`.
 */
export type BroadcastIdentity = Omit<ActiveBroadcast, 'title'>;

/**
 * The YouTube Data API connection: a googleapis client kept in step with
 * YouTubeAuthIntegration, and the integration status that says whether it can
 * be used.
 *
 * Owns connection health — which client to use, whether auth is usable, and
 * noticing a dead refresh token — plus getActiveBroadcast(), the one lookup
 * YouTubeChatIntegration needs as well. Everything else TuringMod does on
 * YouTube lives in YouTubePlatform, which makes its calls through request().
 *
 * Depends on: YouTubeAuthIntegration
 */
@injectable()
@singleton()
export class YouTubeApiIntegration extends BaseIntegration {
  readonly name = 'youtube-api';

  private youtube: youtube_v3.Youtube | null = null;
  /** The auth client `youtube` was built on, to detect it being replaced. */
  private authClient: YouTubeOAuth2Client | null = null;

  constructor(
    logger: Logger,
    private authIntegration: YouTubeAuthIntegration
  ) {
    super(logger, { component: 'YouTubeAPI' });
  }

  override getDependencies(): IIntegration[] {
    return [this.authIntegration];
  }

  /**
   * Resolves its client on access and holds nothing bound to the grant, so a
   * YouTube auth failure blocks this integration rather than stopping it.
   */
  override get dependencyFailurePolicy(): DependencyFailurePolicy {
    return DependencyFailurePolicy.BLOCK;
  }

  override getGroup(): IntegrationGroup {
    return IntegrationGroup.YOUTUBE;
  }

  start(): Promise<void> {
    this.logger.debug('Starting YouTube API integration');
    this.setStatus(IntegrationStatus.CONNECTING);

    try {
      const youtube = this.resolveClient();
      if (!youtube) {
        throw new Error('YouTubeAuthIntegration must be started (and authorized) first');
      }

      this.setStatus(IntegrationStatus.CONNECTED);
      this.logger.debug('YouTube API integration started successfully');

      return Promise.resolve();
    } catch (error) {
      this.logger.error('Failed to start YouTube API integration', error);
      this.setStatus(IntegrationStatus.ERROR, messageOf(error));
      throw error;
    }
  }

  stop(): Promise<void> {
    this.logger.debug('Stopping YouTube API integration');

    this.youtube = null;
    this.authClient = null;
    this.setStatus(IntegrationStatus.DISCONNECTED);

    this.logger.debug('YouTube API integration stopped');
    return Promise.resolve();
  }

  /**
   * Run a YouTube Data API call through the current client. Throws if auth
   * isn't connected. When the failure looks like a dead refresh token, flags
   * the auth integration as needing re-authorization; the error is always
   * rethrown.
   */
  async request<T>(call: (youtube: youtube_v3.Youtube) => Promise<T>): Promise<T> {
    const youtube = this.resolveClient();
    if (!youtube) {
      throw new Error('YouTube API client not initialized');
    }
    try {
      return await call(youtube);
    } catch (error) {
      if (this.authIntegration.isAuthError(error)) {
        this.authIntegration.markAuthRequired();
      }
      throw error;
    }
  }

  /**
   * Resolve the broadcaster's currently active live broadcast, or null if not live.
   */
  async getActiveBroadcast(): Promise<ActiveBroadcast | null> {
    const response = await this.request((youtube) =>
      youtube.liveBroadcasts.list({
        part: ['snippet', 'status'],
        broadcastStatus: 'active',
        broadcastType: 'all',
        mine: true,
      })
    );

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
   * Return a client bound to the auth integration's *current* OAuth2 client,
   * rebuilding it if that client has been replaced since.
   *
   * A client captured once at start() outlives the credentials it was built
   * on — YouTubeAuthIntegration makes a new OAuth2 client each time it starts,
   * so re-authorizing left this integration calling the API through the old
   * one. Resolving on access removes that case instead of relying on the
   * manager to stop this integration in time.
   */
  private resolveClient(): youtube_v3.Youtube | null {
    // markAuthRequired() sets NEEDS_REAUTH without discarding the OAuth2
    // client, so a non-null client here says nothing about whether it can
    // still refresh. Gate on the dependency's status, not just the reference.
    const authClient =
      this.authIntegration.getStatus() === IntegrationStatus.CONNECTED
        ? this.authIntegration.getAuthClient()
        : null;

    if (!authClient) {
      this.youtube = null;
      this.authClient = null;
      return null;
    }

    if (this.youtube && this.authClient === authClient) {
      return this.youtube;
    }

    if (this.authClient) {
      this.logger.info('YouTube auth client was replaced; rebuilding API client');
    }

    this.authClient = authClient;
    this.youtube = google.youtube({ version: 'v3', auth: authClient });
    return this.youtube;
  }
}
