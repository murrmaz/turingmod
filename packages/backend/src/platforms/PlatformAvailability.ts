import type { StreamingPlatform } from '@turingmod/shared';
import { injectable, singleton } from 'tsyringe';
import { EventBus } from '../core/EventBus.js';
import { Logger } from '../utils/Logger.js';
import { PlatformRegistry } from './PlatformRegistry.js';

/**
 * Publishes `platform.availability` whenever a platform becomes usable or stops being usable.
 *
 * "Usable" is the façade's own `getUnavailableReason()`, so features that want to react to a
 * platform recovering ("Twitch just came back, sync rewards now") listen here rather than
 * watching `integration.status` for a particular integration's name — which integration decides
 * a platform's availability is the façade's business, not theirs.
 *
 * Every integration status change triggers a re-check of every platform, since it's the only
 * moment availability can change; only transitions are published.
 */
@injectable()
@singleton()
export class PlatformAvailability {
  private available = new Map<StreamingPlatform, boolean>();
  private logger: Logger;

  constructor(
    private eventBus: EventBus,
    private registry: PlatformRegistry,
    logger: Logger
  ) {
    this.logger = logger.child({ component: 'PlatformAvailability' });
  }

  /** Call after every façade is registered and before integrations start. */
  start(): void {
    for (const platform of this.registry.getAll()) {
      this.available.set(platform.platform, platform.getUnavailableReason() === null);
    }
    this.eventBus.on('integration.status', () => this.recheck());
  }

  private recheck(): void {
    for (const platform of this.registry.getAll()) {
      const reason = platform.getUnavailableReason();
      const available = reason === null;
      if (this.available.get(platform.platform) === available) {
        continue;
      }
      this.available.set(platform.platform, available);
      this.logger.info(available ? 'Platform available' : 'Platform unavailable', {
        platform: platform.platform,
        ...(reason === null ? {} : { reason }),
      });
      this.eventBus.emitSync('platform.availability', {
        platform: platform.platform,
        available,
        reason,
      });
    }
  }
}
