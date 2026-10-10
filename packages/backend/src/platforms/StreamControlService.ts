import type { Platform } from '@turingmod/shared';
import { PlatformCapability } from '@turingmod/shared';
import type { Logger } from '../utils/Logger.js';
import type {
  AdBreakInfo,
  IStreamPlatform,
  ScheduleSegment,
  StreamInfo,
} from './interfaces/IStreamPlatform.js';
import type { PlatformRegistry } from './PlatformRegistry.js';
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
  updated: Platform[];
  /** Per-platform failures encountered while mirroring. */
  failures: { platform: Platform; error: string }[];
}

/**
 * Mirrors broadcaster-control writes (title/game/tags) to every live platform that supports the
 * relevant capability, and delegates reads to a specific platform. This is the seam the
 * provider-backed commands depend on instead of touching Twitch directly.
 */
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

  /** Read current stream metadata from the platform the command originated on. */
  getStreamInfo(platform: Platform): Promise<StreamInfo> {
    const target = this.registry.get(platform);
    if (!target) {
      throw new Error(`Platform not available: ${platform}`);
    }
    return target.getStreamInfo();
  }

  /** Read current broadcast uptime (ms) from a specific platform, or null if offline. */
  getUptime(platform: Platform): Promise<number | null> {
    const target = this.registry.get(platform);
    if (!target) {
      throw new Error(`Platform not available: ${platform}`);
    }
    return target.getUptime();
  }

  // The capability-guarded reads below are async purely so a drifted capability set surfaces
  // as a rejected promise rather than a synchronous throw, whichever way the caller waits.

  /** Ad-break state on a platform, or null if that platform is offline. */
  async getNextAdBreak(platform: Platform): Promise<AdBreakInfo | null> {
    return await this.capableMethod(platform, PlatformCapability.ADS, 'getNextAdBreak')();
  }

  /** Upcoming scheduled broadcasts on a platform, soonest first. */
  async getSchedule(platform: Platform): Promise<ScheduleSegment[]> {
    return await this.capableMethod(platform, PlatformCapability.SCHEDULE, 'getSchedule')();
  }

  /** Content classification labels currently set on a platform's channel. */
  async getContentLabels(platform: Platform): Promise<string[]> {
    return await this.capableMethod(
      platform,
      PlatformCapability.CONTENT_LABELS,
      'getContentLabels'
    )();
  }

  /** Replace a platform's content classification labels. */
  async setContentLabels(platform: Platform, labels: string[]): Promise<void> {
    return await this.capableMethod(
      platform,
      PlatformCapability.CONTENT_LABELS,
      'setContentLabels'
    )(labels);
  }

  /** The broadcaster's channel bio on a platform, or null if unset. */
  async getBroadcasterAbout(platform: Platform): Promise<string | null> {
    return await this.capableMethod(
      platform,
      PlatformCapability.BROADCASTER_ABOUT,
      'getBroadcasterAbout'
    )();
  }

  /**
   * Resolve one of the optional, capability-guarded IStreamPlatform methods, bound to its
   * façade. Asserts the platform both advertises `capability` and implements `method` —
   * commands are capability-filtered before they run, so reaching either throw means a
   * façade's capability set and its method set have drifted apart.
   */
  private capableMethod<K extends OptionalPlatformMethod>(
    platform: Platform,
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

  /**
   * Fan a write out to every live platform whose capability set includes `capability`,
   * collecting per-platform successes and failures.
   */
  private async mirror(
    capability: PlatformCapability,
    info: Partial<StreamInfo>
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
        await platform.setStreamInfo(info);
        result.updated.push(platform.platform);
      } catch (error) {
        this.logger.error(`Failed to mirror ${capability} to ${platform.platform}`, error);
        result.failures.push({ platform: platform.platform, error: this.messageOf(error) });
      }
    }

    return result;
  }

  private messageOf(error: unknown): string {
    return error instanceof Error ? error.message : 'Unknown error';
  }
}
