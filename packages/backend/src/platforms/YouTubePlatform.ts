import { PlatformCapability, StreamingPlatform } from '@turingmod/shared';
import type { youtube_v3 } from 'googleapis';
import { injectable, singleton } from 'tsyringe';
import { toSafeChatText } from '../chat/chatMessage.js';
import { OwnChatMessages } from '../chat/OwnChatMessages.js';
import {
  type BroadcastIdentity,
  YouTubeApiIntegration,
} from '../integrations/implementations/youtube/YouTubeApiIntegration.js';
import { YouTubeChatIntegration } from '../integrations/implementations/youtube/YouTubeChatIntegration.js';
import { unavailableReason } from './availability.js';
import type {
  DeclaredCapability,
  IStreamPlatform,
  StreamInfo,
} from './interfaces/IStreamPlatform.js';

/**
 * IStreamPlatform façade over the YouTube integration trio: everything TuringMod does on YouTube.
 *
 * Owns the YouTube endpoints it calls and the rules around them, and translates them into the
 * platform-agnostic types commands see. Connection health is not its concern: it makes every call
 * through YouTubeApiIntegration.request(). The live broadcast comes from YouTubeChatIntegration
 * while chat is streaming, and from the API otherwise.
 *
 * YouTube has no game/category or tags model, so it declares only SEND_CHAT, SET_TITLE, and
 * UPTIME and has no capability objects — commands requiring the other capabilities auto-hide on
 * YouTube.
 */
@injectable()
@singleton()
export class YouTubePlatform implements IStreamPlatform {
  readonly platform = StreamingPlatform.YOUTUBE;
  readonly declaredCapabilities = new Set<DeclaredCapability>([
    PlatformCapability.SEND_CHAT,
    PlatformCapability.SET_TITLE,
    PlatformCapability.UPTIME,
  ]);

  constructor(
    private api: YouTubeApiIntegration,
    private ownMessages: OwnChatMessages,
    private chat: YouTubeChatIntegration
  ) {}

  getUnavailableReason(): string | null {
    return unavailableReason(this.api, this.platform);
  }

  async isLive(): Promise<boolean> {
    return (await this.liveBroadcast()) !== null;
  }

  async sendChatMessage(message: string): Promise<void> {
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
    const broadcast = await this.liveBroadcast();
    if (!broadcast) {
      throw new Error('No active YouTube broadcast to update');
    }

    // liveBroadcasts.update replaces the snippet, and requires scheduledStartTime, so keep it.
    const snippet: youtube_v3.Schema$LiveBroadcastSnippet = { title: info.title };
    if (broadcast.scheduledStartTime !== null) {
      snippet.scheduledStartTime = broadcast.scheduledStartTime;
    }
    await this.api.request((youtube) =>
      youtube.liveBroadcasts.update({
        part: ['snippet'],
        requestBody: { id: broadcast.id, snippet },
      })
    );
  }

  /** Milliseconds the active broadcast has been live, or null if offline / no start time yet. */
  async getUptime(): Promise<number | null> {
    const broadcast = await this.liveBroadcast();
    if (!broadcast?.actualStartTime) {
      return null;
    }
    return Date.now() - new Date(broadcast.actualStartTime).getTime();
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
}
