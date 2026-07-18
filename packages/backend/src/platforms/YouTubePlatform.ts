import { Platform, PlatformCapability } from '@turingmod/shared';
import type { YouTubeApiIntegration } from '../integrations/implementations/YouTubeApiIntegration.js';
import type { IStreamPlatform, StreamInfo } from './interfaces/IStreamPlatform.js';

/**
 * IStreamPlatform façade over the YouTube integration trio. YouTube has no game/category or tags
 * model, so it advertises only SEND_CHAT, SET_TITLE, and UPTIME — commands requiring the other
 * capabilities auto-hide on YouTube.
 */
export class YouTubePlatform implements IStreamPlatform {
  readonly platform = Platform.YOUTUBE;

  constructor(private api: YouTubeApiIntegration) {}

  getCapabilities(): Set<PlatformCapability> {
    return new Set([
      PlatformCapability.SEND_CHAT,
      PlatformCapability.SET_TITLE,
      PlatformCapability.UPTIME,
    ]);
  }

  async isLive(): Promise<boolean> {
    const broadcast = await this.api.getActiveBroadcast();
    return broadcast !== null;
  }

  async sendChatMessage(message: string): Promise<void> {
    const broadcast = await this.api.getActiveBroadcast();
    if (!broadcast?.liveChatId) {
      throw new Error('No active YouTube live chat to post to');
    }
    await this.api.sendLiveChatMessage(broadcast.liveChatId, message);
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
