import { PlatformCapability, StreamingPlatform } from '@turingmod/shared';
import { injectable, singleton } from 'tsyringe';
import { YouTubeApiIntegration } from '../integrations/implementations/youtube/YouTubeApiIntegration.js';
import { unavailableReason } from './availability.js';
import { toSafeChatText } from './chatMessage.js';
import type { IStreamPlatform, StreamInfo } from './interfaces/IStreamPlatform.js';
import { OwnChatMessages } from './OwnChatMessages.js';

/**
 * IStreamPlatform façade over the YouTube integration trio. YouTube has no game/category or tags
 * model, so it advertises only SEND_CHAT, SET_TITLE, and UPTIME — commands requiring the other
 * capabilities auto-hide on YouTube.
 */
@injectable()
@singleton()
export class YouTubePlatform implements IStreamPlatform {
  readonly platform = StreamingPlatform.YOUTUBE;

  constructor(
    private api: YouTubeApiIntegration,
    private ownMessages: OwnChatMessages
  ) {}

  getCapabilities(): Set<PlatformCapability> {
    return new Set([
      PlatformCapability.SEND_CHAT,
      PlatformCapability.SET_TITLE,
      PlatformCapability.UPTIME,
    ]);
  }

  getUnavailableReason(): string | null {
    return unavailableReason(this.api, this.platform);
  }

  async isLive(): Promise<boolean> {
    const broadcast = await this.api.getActiveBroadcast();
    return broadcast !== null;
  }

  async sendChatMessage(message: string): Promise<void> {
    const text = toSafeChatText(message);
    const broadcast = await this.api.getActiveBroadcast();
    if (!broadcast?.liveChatId) {
      throw new Error('No active YouTube live chat to post to');
    }
    const { liveChatId } = broadcast;
    await this.ownMessages.record(this.platform, () =>
      this.api.sendLiveChatMessage(liveChatId, text)
    );
  }

  async getStreamInfo(): Promise<StreamInfo> {
    const broadcast = await this.api.getActiveBroadcast();
    if (!broadcast) {
      throw new Error('No active YouTube broadcast');
    }
    // YouTube has no game/tags concept, so only the title is populated.
    return { title: broadcast.title };
  }

  async setStreamInfo(info: Partial<StreamInfo>): Promise<void> {
    // Only the title is settable on YouTube; game/tags are silently ignored.
    if (info.title !== undefined) {
      await this.api.setBroadcastTitle(info.title);
    }
  }

  getUptime(): Promise<number | null> {
    return this.api.getUptime();
  }
}
