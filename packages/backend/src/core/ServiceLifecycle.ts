import { injectable, singleton } from 'tsyringe';
import { Logger } from '../utils/Logger.js';

/**
 * An app-lifetime feature service (as opposed to an integration). `ServiceLifecycle` starts each
 * one once, before integrations start, and stops it once, before integrations stop.
 */
export interface IService {
  start?(): void | Promise<void>;
  /** Unsubscribe and release whatever the service holds. Integrations are still connected. */
  stop(): void | Promise<void>;
}

/** Collects EventBus unsubscribe functions so `stop()` can release them all at once. */
export class Subscriptions {
  private unsubscribers: (() => void)[] = [];

  add(...unsubscribers: (() => void)[]): void {
    this.unsubscribers.push(...unsubscribers);
  }

  clear(): void {
    for (const unsubscribe of this.unsubscribers.splice(0)) {
      unsubscribe();
    }
  }
}

/**
 * Starts feature services in the order they were added and stops them in reverse.
 *
 * `Application` starts them before integrations, so a subscriber sees the availability changes
 * integrations cause as they connect, and stops them before integrations, so a service can still
 * reach OBS or Twitch to undo what it did. Add services in dependency order, with whatever
 * triggers actions (chat, redemptions) last: reversed, those stop first, so nothing new starts
 * while the services that undo things are shutting down.
 */
@injectable()
@singleton()
export class ServiceLifecycle {
  private services: IService[] = [];
  private started: IService[] = [];
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger.child({ component: 'ServiceLifecycle' });
  }

  add(service: IService): void {
    this.services.push(service);
  }

  async startAll(): Promise<void> {
    for (const service of this.services) {
      await service.start?.();
      this.started.push(service);
    }
  }

  /** Stop every started service, newest first. One failing never skips the rest. */
  async stopAll(): Promise<void> {
    for (const service of this.started.splice(0).reverse()) {
      try {
        await service.stop();
      } catch (error) {
        this.logger.error(`Failed to stop ${service.constructor.name}`, error);
      }
    }
  }
}
