import { IntegrationStatus, PlatformCapability, StreamingPlatform } from '@turingmod/shared';
import type { youtube_v3 } from 'googleapis';
import { singleton } from 'tsyringe';
import { toSafeChatText } from '../chat/chatMessage.js';
import { OwnChatMessages } from '../chat/OwnChatMessages.js';
import {
  type BroadcastIdentity,
  YouTubeApiIntegration,
} from '../integrations/implementations/youtube/YouTubeApiIntegration.js';
import { YouTubeAuthIntegration } from '../integrations/implementations/youtube/YouTubeAuthIntegration.js';
import { YouTubeChatIntegration } from '../integrations/implementations/youtube/YouTubeChatIntegration.js';
import { unavailableReason } from './availability.js';
import { NotAuthenticatedError } from './errors.js';
import type {
  ChannelPage,
  DeclaredCapability,
  IStreamPlatform,
  LiveBroadcast,
  StreamInfo,
} from './interfaces/IStreamPlatform.js';

/** A broadcast snippet's mutable fields besides the title, carried over when the title changes. */
const KEPT_SNIPPET_FIELDS = ['description', 'scheduledStartTime', 'scheduledEndTime'] as const;

/**
 * IStreamPlatform façade over the YouTube integration trio: everything TuringMod does on YouTube.
 *
 * Owns the YouTube endpoints it calls and the rules around them, and translates them into the
 * platform-agnostic types commands see. Connection health is not its concern: it makes every call
 * through YouTubeApiIntegration.request(), and is usable whenever YouTubeAuthIntegration is
 * connected, which is what request() itself waits on. Each call checks that first and fails with
 * NotAuthenticatedError, like Twitch's. The live broadcast comes from YouTubeChatIntegration
 * while chat is streaming, and from the API otherwise.
 *
 * YouTube has no game/category or tags model, so it declares only SEND_CHAT, SET_TITLE, and
 * UPTIME and has no capability objects — commands requiring the other capabilities auto-hide on
 * YouTube.
 */
@singleton()
export class YouTubePlatform implements IStreamPlatform {
  readonly platform = StreamingPlatform.YOUTUBE;
  readonly declaredCapabilities = new Set<DeclaredCapability>([
    PlatformCapability.SEND_CHAT,
    PlatformCapability.SET_TITLE,
    PlatformCapability.UPTIME,
  ]);

  constructor(
    private auth: YouTubeAuthIntegration,
    private api: YouTubeApiIntegration,
    private ownMessages: OwnChatMessages,
    private chat: YouTubeChatIntegration
  ) {}

  getUnavailableReason(): string | null {
    return unavailableReason(this.auth, this.platform);
  }

  async isLive(): Promise<boolean> {
    return (await this.getLiveBroadcast()) !== null;
  }

  async sendChatMessage(message: string): Promise<void> {
    this.requireAvailable();
    const text = toSafeChatText(message);
    const liveChatId = (await this.liveBroadcast())?.liveChatId;
    if (!liveChatId) {
      throw new Error('No active YouTube live chat to post to');
    }
    await this.ownMessages.record(this.platform, async () => {
      const response = await this.api.request((youtube) =>
        youtube.liveChatMessages.insert({
          part: ['snippet'],
          requestBody: {
            snippet: {
              liveChatId,
              type: 'textMessageEvent',
              textMessageDetails: { messageText: text },
            },
          },
        })
      );
      return response.data.id ?? null;
    });
  }

  async getStreamInfo(): Promise<StreamInfo> {
    this.requireAvailable();
    // Looked up afresh: the title can change mid-stream, so chat's copy of the broadcast has none.
    const broadcast = await this.api.getActiveBroadcast();
    if (!broadcast) {
      throw new Error('No active YouTube broadcast');
    }
    // YouTube has no game/tags concept, so only the title is populated.
    return { title: broadcast.title };
  }

  async setStreamInfo(info: Partial<StreamInfo>): Promise<void> {
    // Only the title is settable on YouTube; game/tags are silently ignored.
    if (info.title === undefined) {
      return;
    }
    this.requireAvailable();
    const broadcast = await this.liveBroadcast();
    if (!broadcast) {
      throw new Error('No active YouTube broadcast to update');
    }

    // liveBroadcasts.update replaces every mutable field of the snippet: one left out is erased.
    // So read the snippet as it is now and send its other mutable fields back unchanged.
    const current = await this.api.request((youtube) =>
      youtube.liveBroadcasts.list({ part: ['snippet'], id: [broadcast.id] })
    );
    const existing = current.data.items?.[0]?.snippet;
    if (!existing) {
      throw new Error('The YouTube broadcast to update no longer exists');
    }
    const snippet: youtube_v3.Schema$LiveBroadcastSnippet = { title: info.title };
    for (const field of KEPT_SNIPPET_FIELDS) {
      const value = existing[field];
      if (value !== null && value !== undefined) {
        snippet[field] = value;
      }
    }
    await this.api.request((youtube) =>
      youtube.liveBroadcasts.update({
        part: ['snippet'],
        requestBody: { id: broadcast.id, snippet },
      })
    );
  }

  async getLiveBroadcast(): Promise<LiveBroadcast | null> {
    // Null rather than a throw while YouTube is unusable, as on Twitch.
    if (this.getUnavailableReason() !== null) {
      return null;
    }
    const broadcast = await this.liveBroadcast();
    if (!broadcast) {
      return null;
    }
    const { actualStartTime } = broadcast;
    return { startedAt: actualStartTime ? new Date(actualStartTime) : null };
  }

  async getChannelPage(): Promise<ChannelPage> {
    this.requireAvailable();
    const response = await this.api.request((youtube) =>
      youtube.channels.list({ part: ['snippet'], mine: true })
    );
    const channel = response.data.items?.[0];
    if (!channel?.id) {
      throw new Error('Failed to retrieve the YouTube channel');
    }
    const displayName = channel.snippet?.title ?? 'YouTube';

    const broadcast = await this.liveBroadcast();
    if (!broadcast) {
      return { displayName, url: `https://www.youtube.com/channel/${channel.id}` };
    }
    return {
      displayName,
      url: `https://www.youtube.com/watch?v=${broadcast.id}`,
      previewImageUrl: `https://i.ytimg.com/vi/${broadcast.id}/hqdefault_live.jpg`,
    };
  }

  /**
   * The live broadcast, or null when there isn't one. While chat is streaming it already knows the
   * broadcast, so this costs an API call only when it isn't: replies and announcements during a
   * stream would otherwise cost an extra call per message. Only for the fields that don't change
   * during a broadcast, which is why the title isn't in it.
   */
  private async liveBroadcast(): Promise<BroadcastIdentity | null> {
    return this.chat.getBroadcast() ?? (await this.api.getActiveBroadcast());
  }

  /** Throw NotAuthenticatedError, saying why, unless YouTube can be acted on. */
  private requireAvailable(): void {
    const reason = this.getUnavailableReason();
    if (reason !== null) {
      throw new NotAuthenticatedError(
        this.platform,
        this.auth.getStatus() === IntegrationStatus.NEEDS_REAUTH,
        reason
      );
    }
  }
}
