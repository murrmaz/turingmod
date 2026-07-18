import type { Platform, PlatformCapability } from '@turingmod/shared';
import type { IStreamPlatform } from './interfaces/IStreamPlatform.js';

/**
 * Registry mapping each Platform to its IStreamPlatform façade. Populated in setup.ts and
 * consulted by StreamControlService, CommandExecutor, and ChatRouter.
 */
export class PlatformRegistry {
  private platforms = new Map<Platform, IStreamPlatform>();

  register(p: IStreamPlatform): void {
    this.platforms.set(p.platform, p);
  }

  get(platform: Platform): IStreamPlatform | undefined {
    return this.platforms.get(platform);
  }

  getAll(): IStreamPlatform[] {
    return [...this.platforms.values()];
  }

  /** Capabilities supported by a specific platform (used to filter commands). */
  capabilitiesFor(platform: Platform): Set<PlatformCapability> {
    return this.get(platform)?.getCapabilities() ?? new Set();
  }
}
