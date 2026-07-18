import type { Platform } from '@turingmod/shared';
import { PlatformCapability } from '@turingmod/shared';
import type { Logger } from '../utils/Logger.js';
import type { PlatformRegistry } from './PlatformRegistry.js';
import type { StreamInfo } from './interfaces/IStreamPlatform.js';

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

      let live: boolean;
      try {
        live = await platform.isLive();
      } catch (error) {
        result.failures.push({ platform: platform.platform, error: this.messageOf(error) });
        continue;
      }

      if (!live) {
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
