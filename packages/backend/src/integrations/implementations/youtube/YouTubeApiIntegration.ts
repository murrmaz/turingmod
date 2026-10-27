import { IntegrationName } from '@turingmod/shared';
import { google, type youtube_v3 } from 'googleapis';
import { singleton } from 'tsyringe';
import { Logger } from '../../../utils/Logger.js';
import { AuthorizedApiIntegration } from '../../AuthorizedApiIntegration.js';
import { ClientCache } from '../../ClientCache.js';
import { YouTubeAuthIntegration, type YouTubeOAuth2Client } from './YouTubeAuthIntegration.js';

/**
 * Normalized view of the broadcaster's currently active live broadcast. `liveChatId` and the
 * start times are only present while a broadcast is active or upcoming, so the Chat integration
 * must idle when this is null.
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
 * YouTubeAuthIntegration (see AuthorizedApiIntegration).
 *
 * Besides that, it notices a dead refresh token, and offers getActiveBroadcast(),
 * the one lookup YouTubeChatIntegration needs as well. Everything else
 * TuringMod does on YouTube lives in YouTubePlatform, which makes its calls
 * through request().
 *
 * Depends on: YouTubeAuthIntegration
 */
@singleton()
export class YouTubeApiIntegration extends AuthorizedApiIntegration<
  YouTubeAuthIntegration,
  youtube_v3.Youtube
> {
  readonly name = IntegrationName.YOUTUBE_API;

  private readonly clients = new ClientCache(
    (auth: YouTubeOAuth2Client) => google.youtube({ version: 'v3', auth }),
    () => this.logger.info('YouTube auth client was replaced; rebuilding API client')
  );

  constructor(logger: Logger, authIntegration: YouTubeAuthIntegration) {
    super(logger, 'YouTube', authIntegration);
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

  protected resolveClient(): youtube_v3.Youtube | null {
    const authClient = this.auth.getAuthClient();
    return authClient ? this.clients.get(authClient) : null;
  }

  protected override forgetClient(): void {
    this.clients.clear();
  }

  /**
   * When the failure looks like a dead refresh token, flags the auth
   * integration as needing re-authorization. The error is always rethrown.
   */
  protected override onRequestFailure<T>(error: unknown): Promise<T> {
    if (this.auth.isAuthError(error)) {
      this.auth.markAuthRequired();
    }
    return Promise.reject(error);
  }
}
