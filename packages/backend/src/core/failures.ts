import { messageOf } from '@turingmod/shared';
import type { Logger } from '../utils/Logger.js';
import type { EventBus } from './EventBus.js';

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
