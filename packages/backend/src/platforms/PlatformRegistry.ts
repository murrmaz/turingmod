import type { PlatformCapability, StreamingPlatform } from '@turingmod/shared';
import { injectable, singleton } from 'tsyringe';
import { capabilitiesOf } from './capabilities.js';
import type { IStreamPlatform } from './interfaces/IStreamPlatform.js';

/**
 * Registry mapping each StreamingPlatform to its IStreamPlatform façade. Populated in setup.ts and
 * consulted by StreamControlService, CommandExecutor, and ChatRouter.
 */
@injectable()
@singleton()
export class PlatformRegistry {
  private platforms = new Map<StreamingPlatform, IStreamPlatform>();

  register(p: IStreamPlatform): void {
    this.platforms.set(p.platform, p);
  }

  get(platform: StreamingPlatform): IStreamPlatform | undefined {
    return this.platforms.get(platform);
  }

  getAll(): IStreamPlatform[] {
    return [...this.platforms.values()];
  }

  /** Capabilities supported by a specific platform (used to filter commands). */
  capabilitiesFor(platform: StreamingPlatform): Set<PlatformCapability> {
    const target = this.get(platform);
    return target ? capabilitiesOf(target) : new Set();
  }
}
