import type { StreamingPlatform } from '@turingmod/shared';
import { messageOf, PlatformCapability } from '@turingmod/shared';
import { injectable, singleton } from 'tsyringe';
import { Logger } from '../utils/Logger.js';
import { CAPABILITY_OF_API, capabilitiesOf } from './capabilities.js';
import type {
  CapabilityApiName,
  CapabilityApis,
  IStreamPlatform,
  StreamInfo,
} from './interfaces/IStreamPlatform.js';
import { PlatformRegistry } from './PlatformRegistry.js';
import { platformDisplayName } from './platformNames.js';

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
 * relevant capability, delegates reads to a specific platform, and hands out a platform's
 * capability objects (`require()`). This is the seam the provider-backed commands depend on
 * instead of touching Twitch directly.
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

  /** Read current broadcast uptime (ms) from a specific platform, or null if offline. */
  getUptime(platform: StreamingPlatform): Promise<number | null> {
    return this.target(platform).getUptime();
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
      if (!capabilitiesOf(platform).has(capability)) {
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
        result.failures.push({ platform: platform.platform, error: messageOf(error) });
      }
    }

    return result;
  }
}
