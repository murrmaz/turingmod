import { IntegrationStatus, messageOf } from '@turingmod/shared';
import { singleton } from 'tsyringe';
import { Logger } from '../utils/Logger.js';
import type { EventBus } from './EventBus.js';

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
 * Tells the streamer about a failure the service carries on from. `message` says what happened and
 * what to do about it; a caught `error` is logged with its stack, and its message follows `message`
 * in the activity log and live feed.
 */
export type ReportFailure = (message: string, error?: unknown) => void;

/**
 * A service's `ReportFailure`, publishing `service.error` under the name the streamer sees for it.
 * A log line alone reaches only the terminal, so this is what a failure the streamer must know about
 * goes through.
 */
export function failureReporter(
  eventBus: EventBus,
  logger: Logger,
  service: string
): ReportFailure {
  return (message, error) => {
    logger.error(message, error);
    eventBus.emitSync('service.error', {
      service,
      message: error === undefined ? message : `${message} ${messageOf(error)}`,
    });
  };
}

/**
 * Failures that would recur for as long as their cause lasts, such as chat replies while a platform
 * is refusing them. The first of a run of one kind is reported; the rest are only logged, until
 * `recovered()` says that kind worked again, so an outage is one entry in the feed rather than one
 * per message.
 */
export class RepeatingFailures {
  private failing = new Set<string>();

  constructor(
    private report: ReportFailure,
    private logger: Logger
  ) {}

  failed(kind: string, message: string, error?: unknown): void {
    if (this.failing.has(kind)) {
      this.logger.error(message, error);
      return;
    }
    this.failing.add(kind);
    this.report(message, error);
  }

  recovered(kind: string): void {
    this.failing.delete(kind);
  }
}

/** `RepeatingFailures` reporting through its own `failureReporter()`, under the name `service`. */
export function repeatingFailures(
  eventBus: EventBus,
  logger: Logger,
  service: string
): RepeatingFailures {
  return new RepeatingFailures(failureReporter(eventBus, logger, service), logger);
}

/**
 * Run `handler` each time `integration` reaches CONNECTED, whatever it was before. Returns the
 * unsubscribe function, for `Subscriptions`.
 */
export function onConnected(
  eventBus: EventBus,
  integration: { readonly name: string },
  handler: () => void | Promise<void>
): () => void {
  return eventBus.on('integration.status', ({ name, status }) => {
    if (name === integration.name && status === IntegrationStatus.CONNECTED) {
      return handler();
    }
  });
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
