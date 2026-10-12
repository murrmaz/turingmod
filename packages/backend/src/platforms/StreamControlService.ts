import type { StreamingPlatform } from '@turingmod/shared';
import { PlatformCapability } from '@turingmod/shared';
import { injectable, singleton } from 'tsyringe';
import { Logger } from '../utils/Logger.js';
import type {
  AdBreakInfo,
  AdSnoozeResult,
  ChannelReward,
  ChannelRewardChanges,
  ChannelRewardSettings,
  ClipInfo,
  IStreamPlatform,
  RedemptionOutcome,
  ScheduleSegment,
  ShoutoutResult,
  StreamInfo,
  StreamMarker,
  VodInfo,
} from './interfaces/IStreamPlatform.js';
import { PlatformRegistry } from './PlatformRegistry.js';
import { platformDisplayName } from './platformNames.js';

/** The IStreamPlatform methods that are optional because a capability guards them. */
type OptionalPlatformMethod = {
  [K in keyof IStreamPlatform]-?: undefined extends IStreamPlatform[K] ? K : never;
}[keyof IStreamPlatform];

/**
 * Outcome of a mirrored write. Records which platforms accepted the change and any that failed,
 * so a command can compose a chat reply like `Title updated on Twitch, YouTube`.
 */
export interface MirrorResult {
  /** Platforms the change was successfully applied to. */
  updated: StreamingPlatform[];
  /** Per-platform failures encountered while mirroring. */
  failures: { platform: StreamingPlatform; error: string }[];
}

/**
 * Mirrors broadcaster-control writes (title/game/tags) to every live platform that supports the
 * relevant capability, and delegates reads to a specific platform. This is the seam the
 * provider-backed commands depend on instead of touching Twitch directly.
 */
@injectable()
@singleton()
export class StreamControlService {
  private logger: Logger;

  constructor(
    private registry: PlatformRegistry,
    logger: Logger
  ) {
    this.logger = logger.child({ component: 'StreamControlService' });
  }

  /** Mirror a title change to every live platform that supports SET_TITLE. */
  setTitle(title: string): Promise<MirrorResult> {
    return this.mirror(PlatformCapability.SET_TITLE, { title });
  }

  /** Mirror a game/category change to every live platform that supports SET_GAME (Twitch only). */
  setGame(game: string): Promise<MirrorResult> {
    return this.mirror(PlatformCapability.SET_GAME, { game });
  }

  /** Mirror a tags change to every live platform that supports SET_TAGS (Twitch only). */
  setTags(tags: string[]): Promise<MirrorResult> {
    return this.mirror(PlatformCapability.SET_TAGS, { tags });
  }

  /**
   * Post a chat message to every live platform. `messageFor` picks the wording per platform and
   * returns null to skip one. Platforms whose auth is broken are skipped and logged, never
   * reported to chat, for the same reason as mirrored writes (see mirror()).
   *
   * With `highlight`, platforms that have highlighted announcements (ANNOUNCEMENTS) post one;
   * the rest post a plain message.
   */
  announce(
    messageFor: (platform: StreamingPlatform) => string | null,
    { highlight = false }: { highlight?: boolean } = {}
  ): Promise<MirrorResult> {
    return this.forEachLivePlatform(PlatformCapability.SEND_CHAT, async (platform) => {
      const message = messageFor(platform.platform);
      if (message === null) {
        return false;
      }
      if (
        highlight &&
        platform.sendAnnouncement &&
        platform.getCapabilities().has(PlatformCapability.ANNOUNCEMENTS)
      ) {
        await platform.sendAnnouncement(message);
      } else {
        await platform.sendChatMessage(message);
      }
      return true;
    });
  }

  /** Post a message to one platform's chat, whether or not it is live. */
  sendChatMessage(platform: StreamingPlatform, message: string): Promise<void> {
    const target = this.registry.get(platform);
    if (!target) {
      throw new Error(`Platform not available: ${platform}`);
    }
    return target.sendChatMessage(message);
  }

  /** Whether a platform is registered and advertises `capability`. */
  supports(platform: StreamingPlatform, capability: PlatformCapability): boolean {
    return this.registry.get(platform)?.getCapabilities().has(capability) ?? false;
  }

  /** Read current stream metadata from the platform the command originated on. */
  getStreamInfo(platform: StreamingPlatform): Promise<StreamInfo> {
    const target = this.registry.get(platform);
    if (!target) {
      throw new Error(`Platform not available: ${platform}`);
    }
    return target.getStreamInfo();
  }

  /** Read current broadcast uptime (ms) from a specific platform, or null if offline. */
  getUptime(platform: StreamingPlatform): Promise<number | null> {
    const target = this.registry.get(platform);
    if (!target) {
      throw new Error(`Platform not available: ${platform}`);
    }
    return target.getUptime();
  }

  // The capability-guarded reads below are async purely so a drifted capability set surfaces
  // as a rejected promise rather than a synchronous throw, whichever way the caller waits.

  /** Ad-break state on a platform, or null if that platform is offline. */
  async getNextAdBreak(platform: StreamingPlatform): Promise<AdBreakInfo | null> {
    return await this.capableMethod(platform, PlatformCapability.ADS, 'getNextAdBreak')();
  }

  /** Upcoming scheduled broadcasts on a platform, soonest first. */
  async getSchedule(platform: StreamingPlatform): Promise<ScheduleSegment[]> {
    return await this.capableMethod(platform, PlatformCapability.SCHEDULE, 'getSchedule')();
  }

  /** Content classification labels currently set on a platform's channel. */
  async getContentLabels(platform: StreamingPlatform): Promise<string[]> {
    return await this.capableMethod(
      platform,
      PlatformCapability.CONTENT_LABELS,
      'getContentLabels'
    )();
  }

  /** Replace a platform's content classification labels. */
  async setContentLabels(platform: StreamingPlatform, labels: string[]): Promise<void> {
    return await this.capableMethod(
      platform,
      PlatformCapability.CONTENT_LABELS,
      'setContentLabels'
    )(labels);
  }

  /** The broadcaster's channel bio on a platform, or null if unset. */
  async getBroadcasterAbout(platform: StreamingPlatform): Promise<string | null> {
    return await this.capableMethod(
      platform,
      PlatformCapability.BROADCASTER_ABOUT,
      'getBroadcasterAbout'
    )();
  }

  /** Send a platform's native shoutout for another channel, by its login name. */
  async shoutout(platform: StreamingPlatform, channelName: string): Promise<ShoutoutResult> {
    return await this.capableMethod(platform, PlatformCapability.SHOUTOUT, 'shoutout')(channelName);
  }

  /** Every channel point reward on a platform's channel. */
  async getChannelRewards(platform: StreamingPlatform): Promise<ChannelReward[]> {
    return await this.capableMethod(
      platform,
      PlatformCapability.CHANNEL_POINTS,
      'getChannelRewards'
    )();
  }

  /** Create an enabled channel point reward. */
  async createChannelReward(
    platform: StreamingPlatform,
    settings: ChannelRewardSettings
  ): Promise<ChannelReward> {
    return await this.capableMethod(
      platform,
      PlatformCapability.CHANNEL_POINTS,
      'createChannelReward'
    )(settings);
  }

  /** Update a channel point reward this application created. */
  async updateChannelReward(
    platform: StreamingPlatform,
    rewardId: string,
    changes: ChannelRewardChanges
  ): Promise<void> {
    return await this.capableMethod(
      platform,
      PlatformCapability.CHANNEL_POINTS,
      'updateChannelReward'
    )(rewardId, changes);
  }

  /** Complete or cancel (refunding the viewer) a queued redemption. */
  async resolveRedemption(
    platform: StreamingPlatform,
    rewardId: string,
    redemptionId: string,
    outcome: RedemptionOutcome
  ): Promise<void> {
    return await this.capableMethod(
      platform,
      PlatformCapability.CHANNEL_POINTS,
      'resolveRedemption'
    )(rewardId, redemptionId, outcome);
  }

  /** Time a user out of a platform's chat. */
  async timeoutUser(
    platform: StreamingPlatform,
    userId: string,
    seconds: number,
    reason: string
  ): Promise<void> {
    return await this.capableMethod(platform, PlatformCapability.MODERATION, 'timeoutUser')(
      userId,
      seconds,
      reason
    );
  }

  /** Delete one message from a platform's chat. */
  async deleteChatMessage(platform: StreamingPlatform, messageId: string): Promise<void> {
    return await this.capableMethod(
      platform,
      PlatformCapability.MODERATION,
      'deleteChatMessage'
    )(messageId);
  }

  /** Look up a clip on a platform; null if there's no such clip. */
  async getClip(platform: StreamingPlatform, clipId: string): Promise<ClipInfo | null> {
    return await this.capableMethod(platform, PlatformCapability.CLIPS, 'getClip')(clipId);
  }

  /** Push a platform's next ad back, if it has a snooze left. */
  async snoozeNextAd(platform: StreamingPlatform): Promise<AdSnoozeResult> {
    return await this.capableMethod(platform, PlatformCapability.ADS, 'snoozeNextAd')();
  }

  /** When a user started following on a platform, or null if they don't. */
  async getFollowDate(platform: StreamingPlatform, userId: string): Promise<Date | null> {
    return await this.capableMethod(
      platform,
      PlatformCapability.FOLLOW_INFO,
      'getFollowDate'
    )(userId);
  }

  /** When a user's account on a platform was created, or null if there's no such user. */
  async getAccountCreatedAt(platform: StreamingPlatform, userId: string): Promise<Date | null> {
    return await this.capableMethod(
      platform,
      PlatformCapability.ACCOUNT_AGE,
      'getAccountCreatedAt'
    )(userId);
  }

  /** Mark the current point of a platform's live broadcast. */
  async createStreamMarker(
    platform: StreamingPlatform,
    description?: string
  ): Promise<StreamMarker> {
    return await this.capableMethod(
      platform,
      PlatformCapability.MARKERS,
      'createStreamMarker'
    )(description);
  }

  /** Delete a platform's most recent past broadcast; null if there was none. */
  async deleteLatestVod(platform: StreamingPlatform): Promise<VodInfo | null> {
    return await this.capableMethod(platform, PlatformCapability.VODS, 'deleteLatestVod')();
  }

  /**
   * Resolve one of the optional, capability-guarded IStreamPlatform methods, bound to its
   * façade. Asserts the platform both advertises `capability` and implements `method` —
   * commands are capability-filtered before they run, so reaching either throw means a
   * façade's capability set and its method set have drifted apart.
   */
  private capableMethod<K extends OptionalPlatformMethod>(
    platform: StreamingPlatform,
    capability: PlatformCapability,
    method: K
  ): NonNullable<IStreamPlatform[K]> {
    const target = this.registry.get(platform);
    if (!target) {
      throw new Error(`Platform not available: ${platform}`);
    }
    if (!target.getCapabilities().has(capability)) {
      throw new Error(`${platform} does not support ${capability}`);
    }

    const fn = target[method];
    if (typeof fn !== 'function') {
      throw new Error(`${platform} advertises ${capability} but does not implement ${method}`);
    }

    return fn.bind(target) as NonNullable<IStreamPlatform[K]>;
  }

  /** Fan a metadata write out to every live platform that supports `capability`. */
  private mirror(capability: PlatformCapability, info: Partial<StreamInfo>): Promise<MirrorResult> {
    return this.forEachLivePlatform(capability, async (platform) => {
      await platform.setStreamInfo(info);
      return true;
    });
  }

  /**
   * Run `action` on every live platform whose capability set includes `capability`, collecting
   * per-platform successes and failures. `action` returns false to skip a platform without it
   * counting as either.
   */
  private async forEachLivePlatform(
    capability: PlatformCapability,
    action: (platform: IStreamPlatform) => Promise<boolean>
  ): Promise<MirrorResult> {
    const result: MirrorResult = { updated: [], failures: [] };

    for (const platform of this.registry.getAll()) {
      if (!platform.getCapabilities().has(capability)) {
        continue;
      }

      // A broken OAuth grant must not reach chat: a mirrored write replies in public, so the
      // whole channel would see the state of the broadcaster's tokens. It mustn't vanish
      // either, or the command reports the misleading "No live platforms to update". Log it
      // for the streamer and skip.
      const unavailable = platform.getUnavailableReason();
      if (unavailable) {
        this.logger.warn(
          `Skipping ${platformDisplayName(platform.platform)} for ${capability}: ${unavailable}`
        );
        continue;
      }

      let live: boolean;
      try {
        live = await platform.isLive();
      } catch (error) {
        result.failures.push({ platform: platform.platform, error: this.messageOf(error) });
        continue;
      }

      if (!live) {
        this.logger.debug(
          `Skipping ${platformDisplayName(platform.platform)} for ${capability}: not broadcasting`
        );
        continue;
      }

      try {
        if (await action(platform)) {
          result.updated.push(platform.platform);
        }
      } catch (error) {
        this.logger.error(`Failed to apply ${capability} on ${platform.platform}`, error);
        result.failures.push({ platform: platform.platform, error: this.messageOf(error) });
      }
    }

    return result;
  }

  private messageOf(error: unknown): string {
    return error instanceof Error ? error.message : 'Unknown error';
  }
}
