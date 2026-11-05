import type { StreamingPlatform } from '@turingmod/shared';
import {
  formatPlatformList,
  messageOf,
  PlatformCapability,
  platformDisplayName,
} from '@turingmod/shared';
import { singleton } from 'tsyringe';
import { EventBus } from '../core/EventBus.js';
import type { RepeatingFailures, ReportFailure } from '../core/failures.js';
import { failureReporter } from '../core/failures.js';
import { Logger } from '../utils/Logger.js';
import { CAPABILITY_OF_API, capabilitiesOf } from './capabilities.js';
import { InvalidStreamInfoError } from './errors.js';
import type {
  CapabilityApiName,
  CapabilityApis,
  ChannelPage,
  IStreamPlatform,
  LiveBroadcast,
  StreamInfo,
} from './interfaces/IStreamPlatform.js';
import { PlatformRegistry } from './PlatformRegistry.js';

/**
 * Outcome of a mirrored write. Records which platforms accepted the change and any that failed,
 * so a command can compose a chat reply like `Title updated on Twitch, YouTube`.
 */
export interface MirrorResult {
  /** Platforms the change was successfully applied to. */
  updated: StreamingPlatform[];
  /** Per-platform failures encountered while mirroring. */
  failures: MirrorFailure[];
  /** Platforms that couldn't be tried, which `failures` leaves out since chat may repeat those. */
  skipped: MirrorSkip[];
}

export interface MirrorSkip {
  platform: StreamingPlatform;
  /** Why it can't be acted on (authorization lost, not connected), for the streamer only. */
  reason: string;
}

export interface MirrorFailure {
  platform: StreamingPlatform;
  /** What went wrong, for the streamer: the platform's own error text. */
  error: string;
  /**
   * The platform has no such value as the one asked for (InvalidStreamInfoError), so `error` is
   * written for whoever asked and may be repeated in chat. Absent for any other failure.
   */
  invalidValue?: true;
}

/**
 * Reports what an announcement didn't reach. `announce()` lists a platform that fails instead of
 * throwing, so a caller that doesn't read its result hears nothing about it. Per platform and once
 * per run of failures, since announcements repeat. A skipped platform isn't reported: its integration
 * already shows why.
 */
export function reportAnnouncement(
  result: MirrorResult,
  failures: RepeatingFailures,
  what: string
): void {
  for (const { platform, error } of result.failures) {
    failures.failed(platform, `Could not post ${what} on ${platformDisplayName(platform)}.`, error);
  }
  for (const platform of result.updated) {
    failures.recovered(platform);
  }
}

/**
 * Mirrors broadcaster-control writes (title/game/tags) to every live platform that supports the
 * relevant capability, delegates reads to a specific platform, and hands out a platform's
 * capability objects (`require()`). This is the seam the provider-backed commands depend on
 * instead of touching Twitch directly.
 */
@singleton()
export class StreamControlService {
  private logger: Logger;
  private report: ReportFailure;

  constructor(
    private registry: PlatformRegistry,
    private eventBus: EventBus,
    logger: Logger
  ) {
    this.logger = logger.child({ component: 'StreamControlService' });
    this.report = failureReporter(eventBus, this.logger, 'Stream info');
  }

  /** Mirror a title change to every live platform that supports SET_TITLE. */
  setTitle(title: string): Promise<MirrorResult> {
    return this.mirror(PlatformCapability.SET_TITLE, 'title', { title });
  }

  /** Mirror a game/category change to every live platform that supports SET_GAME (Twitch only). */
  setGame(game: string): Promise<MirrorResult> {
    return this.mirror(PlatformCapability.SET_GAME, 'game', { game });
  }

  /** Mirror a tags change to every live platform that supports SET_TAGS (Twitch only). */
  setTags(tags: string[]): Promise<MirrorResult> {
    return this.mirror(PlatformCapability.SET_TAGS, 'tags', { tags });
  }

  /**
   * Post a chat message to every live platform. `messageFor` picks the wording per platform and
   * returns null to skip one. Platforms whose auth is broken are skipped and logged, never
   * reported to chat, for the same reason as mirrored writes (see mirror()). Never rejects: a
   * platform that fails is logged here and listed in the result, which a caller passes to
   * `reportAnnouncement()` so the streamer hears about it.
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
      if (highlight && platform.announcements) {
        await platform.announcements.sendAnnouncement(message);
      } else {
        await platform.sendChatMessage(message);
      }
      return true;
    });
  }

  /** Post a message to one platform's chat, whether or not it is live. */
  sendChatMessage(platform: StreamingPlatform, message: string): Promise<void> {
    return this.target(platform).sendChatMessage(message);
  }

  /** Whether a platform is registered and advertises `capability`. */
  supports(platform: StreamingPlatform, capability: PlatformCapability): boolean {
    const target = this.registry.get(platform);
    return target ? capabilitiesOf(target).has(capability) : false;
  }

  /** Read current stream metadata from the platform the command originated on. */
  getStreamInfo(platform: StreamingPlatform): Promise<StreamInfo> {
    return this.target(platform).getStreamInfo();
  }

  /** The platform's current broadcast, or null when it's offline. */
  getLiveBroadcast(platform: StreamingPlatform): Promise<LiveBroadcast | null> {
    return this.target(platform).getLiveBroadcast();
  }

  /** Read current broadcast uptime (ms) from a specific platform, or null if offline. */
  async getUptime(platform: StreamingPlatform): Promise<number | null> {
    const startedAt = (await this.getLiveBroadcast(platform))?.startedAt;
    return startedAt ? Date.now() - startedAt.getTime() : null;
  }

  /** Every registered platform, in registry order. */
  platforms(): StreamingPlatform[] {
    return this.registry.getAll().map((facade) => facade.platform);
  }

  /**
   * Why a platform can't be acted on (not connected, authorization lost), or null if it can. A
   * platform that isn't registered can't be, and says so.
   */
  getUnavailableReason(platform: StreamingPlatform): string | null {
    const target = this.registry.get(platform);
    return target ? target.getUnavailableReason() : `Platform not available: ${platform}`;
  }

  /** Whether a platform is connected and broadcasting. */
  isLive(platform: StreamingPlatform): Promise<boolean> {
    return isBroadcasting(this.target(platform));
  }

  /** A platform's channel name and where to watch it. */
  getChannelPage(platform: StreamingPlatform): Promise<ChannelPage> {
    return this.target(platform).getChannelPage();
  }

  /**
   * A platform's capability object, e.g. `require(TWITCH, 'channelPoints')`. Throws if the
   * platform isn't registered or doesn't have that capability. Commands are capability-filtered
   * before they run, so a command reaching the second throw has a `requiredCapabilities` that
   * doesn't cover what it uses.
   */
  require<K extends CapabilityApiName>(
    platform: StreamingPlatform,
    capability: K
  ): CapabilityApis[K] {
    const apis: Partial<CapabilityApis> = this.target(platform);
    const api: CapabilityApis[K] | undefined = apis[capability];
    if (!api) {
      throw new Error(
        `${platformDisplayName(platform)} does not support ${CAPABILITY_OF_API[capability]}`
      );
    }
    return api;
  }

  private target(platform: StreamingPlatform): IStreamPlatform {
    const target = this.registry.get(platform);
    if (!target) {
      throw new Error(`Platform not available: ${platform}`);
    }
    return target;
  }

  /**
   * Fan a metadata write out to every live platform that supports `capability`.
   *
   * A write no platform took fails the command, whose reason tells the streamer why. One that some
   * platform took is a success in chat, so a platform that failed is reported here instead, or the
   * streamer would believe the change reached every platform. A skipped platform isn't: its
   * integration already shows why, as with `reportAnnouncement()`.
   */
  private async mirror(
    capability: PlatformCapability,
    what: string,
    info: Partial<StreamInfo>
  ): Promise<MirrorResult> {
    const result = await this.forEachLivePlatform(capability, async (platform) => {
      await platform.setStreamInfo(info);
      return true;
    });
    if (result.updated.length > 0) {
      this.eventBus.emitSync('stream.info.changed', { platforms: result.updated });
      const updated = formatPlatformList(result.updated);
      for (const { platform, error } of result.failures) {
        this.report(
          `The ${what} was updated on ${updated}, but not on ${platformDisplayName(platform)}.`,
          error
        );
      }
    }
    return result;
  }

  /**
   * Run `action` on every live platform whose capability set includes `capability`, collecting
   * per-platform successes and failures. `action` returns false to skip a platform without it
   * counting as either. Never rejects: whatever a platform throws is that platform's failure.
   */
  private async forEachLivePlatform(
    capability: PlatformCapability,
    action: (platform: IStreamPlatform) => Promise<boolean>
  ): Promise<MirrorResult> {
    const result: MirrorResult = { updated: [], failures: [], skipped: [] };

    for (const platform of this.registry.getAll()) {
      if (!capabilitiesOf(platform).has(capability)) {
        continue;
      }

      // A broken OAuth grant must not reach chat: a mirrored write replies in public, so the
      // whole channel would see the state of the broadcaster's tokens. It mustn't vanish
      // either, or the command reports the misleading "No live platforms to update". So it's
      // listed apart from failures, whose text chat may repeat.
      let unavailable: string | null;
      try {
        unavailable = platform.getUnavailableReason();
      } catch (error) {
        this.logger.error(`Could not ask whether ${platform.platform} is available`, error);
        result.failures.push({ platform: platform.platform, error: messageOf(error) });
        continue;
      }
      if (unavailable) {
        this.logger.warn(
          `Skipping ${platformDisplayName(platform.platform)} for ${capability}: ${unavailable}`
        );
        result.skipped.push({ platform: platform.platform, reason: unavailable });
        continue;
      }

      let live: boolean;
      try {
        live = await isBroadcasting(platform);
      } catch (error) {
        this.logger.error(`Could not ask whether ${platform.platform} is live`, error);
        result.failures.push({ platform: platform.platform, error: messageOf(error) });
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
        result.failures.push({
          platform: platform.platform,
          error: messageOf(error),
          ...(error instanceof InvalidStreamInfoError ? { invalidValue: true } : {}),
        });
      }
    }

    return result;
  }
}

/** Whether a platform is connected and broadcasting: whether it has a live broadcast to give. */
async function isBroadcasting(platform: IStreamPlatform): Promise<boolean> {
  return (await platform.getLiveBroadcast()) !== null;
}
