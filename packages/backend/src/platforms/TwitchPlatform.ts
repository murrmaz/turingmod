import { Platform, PlatformCapability } from '@turingmod/shared';
import type { TwitchApiIntegration } from '../integrations/implementations/TwitchApiIntegration.js';
import type { TwitchAuthIntegration } from '../integrations/implementations/TwitchAuthIntegration.js';
import type { IStreamPlatform, StreamInfo } from './interfaces/IStreamPlatform.js';

/**
 * IStreamPlatform façade over the Twitch integration trio. Resolves the broadcaster id from
 * TwitchAuthIntegration and delegates reads/writes to TwitchApiIntegration's Helix methods.
 * Category search (name → id) stays Twitch-specific and lives here rather than in commands.
 */
export class TwitchPlatform implements IStreamPlatform {
  readonly platform = Platform.TWITCH;

  constructor(
    private auth: TwitchAuthIntegration,
    private api: TwitchApiIntegration
  ) {}

  getCapabilities(): Set<PlatformCapability> {
    return new Set([
      PlatformCapability.SEND_CHAT,
      PlatformCapability.SET_TITLE,
      PlatformCapability.SET_GAME,
      PlatformCapability.SET_TAGS,
      PlatformCapability.UPTIME,
      PlatformCapability.ADS,
      PlatformCapability.SCHEDULE,
      PlatformCapability.CONTENT_LABELS,
      PlatformCapability.FOLLOW_INFO,
    ]);
  }

  async isLive(): Promise<boolean> {
    const userId = this.auth.getAuthenticatedUserId();
    if (!userId) {
      return false;
    }
    const stream = await this.api.getStream(userId);
    return stream !== null;
  }

  async sendChatMessage(message: string): Promise<void> {
    const userId = this.requireUserId();
    await this.api.sendChatMessage(userId, message);
  }

  async getStreamInfo(): Promise<StreamInfo> {
    const userId = this.requireUserId();
    const channel = await this.api.getChannel(userId);
    if (!channel) {
      throw new Error('Failed to retrieve channel information');
    }

    const info: StreamInfo = { title: channel.title };
    if (channel.gameName) {
      info.game = channel.gameName;
    }
    if (channel.tags && channel.tags.length > 0) {
      info.tags = channel.tags;
    }
    return info;
  }

  async setStreamInfo(info: Partial<StreamInfo>): Promise<void> {
    const userId = this.requireUserId();

    if (info.title !== undefined) {
      await this.api.setStreamTitle(userId, info.title);
    }

    if (info.game !== undefined) {
      const game = await this.api.searchGame(info.game);
      if (!game) {
        throw new Error(`Game not found: ${info.game}`);
      }
      await this.api.setStreamGame(userId, game.id);
    }

    if (info.tags !== undefined) {
      await this.api.setStreamTags(userId, info.tags);
    }
  }

  async getUptime(): Promise<number | null> {
    const userId = this.auth.getAuthenticatedUserId();
    if (!userId) {
      return null;
    }
    const stream = await this.api.getStream(userId);
    if (!stream) {
      return null;
    }
    return Date.now() - stream.startDate.getTime();
  }

  private requireUserId(): string {
    const userId = this.auth.getAuthenticatedUserId();
    if (!userId) {
      throw new Error('Not authenticated with Twitch');
    }
    return userId;
  }
}
