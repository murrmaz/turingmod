import { IntegrationStatus, Platform, PlatformCapability } from '@turingmod/shared';
import type { TwitchApiIntegration } from '../integrations/implementations/twitch/TwitchApiIntegration.js';
import type { TwitchAuthIntegration } from '../integrations/implementations/twitch/TwitchAuthIntegration.js';
import { unavailableReason } from './availability.js';
import { NotAuthenticatedError } from './errors.js';
import type {
  AdBreakInfo,
  IStreamPlatform,
  ScheduleSegment,
  StreamInfo,
} from './interfaces/IStreamPlatform.js';

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
      PlatformCapability.BROADCASTER_ABOUT,
    ]);
  }

  getUnavailableReason(): string | null {
    const reason = unavailableReason(this.auth, this.platform);
    if (reason) {
      return reason;
    }
    // Connected but without a broadcaster id is not a state start() leaves behind; treat it
    // as unusable rather than letting a later call fail with a vaguer error.
    return this.auth.getAuthenticatedUserId() ? null : 'Twitch broadcaster id unavailable';
  }

  async isLive(): Promise<boolean> {
    // Defined to answer false rather than throw, so StreamControlService can skip an
    // unauthenticated platform while mirroring instead of recording it as a failure.
    const userId = this.authenticatedUserId();
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
    // Null rather than a throw: "not authenticated" and "offline" are the same answer here.
    const userId = this.authenticatedUserId();
    if (!userId) {
      return null;
    }
    const stream = await this.api.getStream(userId);
    if (!stream) {
      return null;
    }
    return Date.now() - stream.startDate.getTime();
  }

  async getNextAdBreak(): Promise<AdBreakInfo | null> {
    const userId = this.requireUserId();
    const stream = await this.api.getStream(userId);
    if (!stream) {
      return null;
    }
    const adSchedule = await this.api.getAdSchedule(userId);
    return { nextAdDate: adSchedule?.nextAdDate ?? null };
  }

  async getSchedule(): Promise<ScheduleSegment[]> {
    const userId = this.requireUserId();
    const schedule = await this.api.getSchedule(userId);
    const segments = schedule?.data?.segments ?? [];

    return segments.map((segment) => {
      const mapped: ScheduleSegment = { startDate: segment.startDate };
      if (segment.title) {
        mapped.title = segment.title;
      }
      if (segment.categoryName) {
        mapped.category = segment.categoryName;
      }
      return mapped;
    });
  }

  async getContentLabels(): Promise<string[]> {
    const userId = this.requireUserId();
    const channel = await this.api.getChannel(userId);
    if (!channel) {
      throw new Error('Failed to retrieve channel information');
    }
    return channel.contentClassificationLabels ?? [];
  }

  async setContentLabels(labels: string[]): Promise<void> {
    const userId = this.requireUserId();
    await this.api.setContentClassificationLabels(userId, labels);
  }

  async getBroadcasterAbout(): Promise<string | null> {
    const userId = this.requireUserId();
    const user = await this.api.getUserById(userId);
    const description = user?.description?.trim();
    return description ? description : null;
  }

  /**
   * The broadcaster id, but only while auth is actually usable. Keyed on the integration's
   * status rather than the id alone: the id outlives a stop(), so a non-null id on its own
   * doesn't prove the API client behind it still exists.
   */
  private authenticatedUserId(): string | null {
    if (this.auth.getStatus() !== IntegrationStatus.CONNECTED) {
      return null;
    }
    return this.auth.getAuthenticatedUserId();
  }

  /**
   * Resolve the broadcaster id or explain why Twitch is unusable. Token expiry never lands
   * here — the RefreshingAuthProvider renews in the background and only downgrades the
   * integration's status once a refresh has definitively failed.
   */
  private requireUserId(): string {
    const userId = this.authenticatedUserId();
    if (userId) {
      return userId;
    }

    throw new NotAuthenticatedError(
      Platform.TWITCH,
      this.auth.getStatus() === IntegrationStatus.NEEDS_REAUTH,
      this.getUnavailableReason() ?? 'Not connected to Twitch'
    );
  }
}
