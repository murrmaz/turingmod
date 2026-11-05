import { ANNOUNCEMENT_INTERVAL_MS } from '@turingmod/shared';
import { singleton } from 'tsyringe';
import { EventBus } from '../../../core/EventBus.js';
import { type RepeatingFailures, repeatingFailures } from '../../../core/failures.js';
import { type IService } from '../../../core/ServiceLifecycle.js';
import {
  reportAnnouncement,
  StreamControlService,
} from '../../../platforms/StreamControlService.js';
import { Logger } from '../../../utils/Logger.js';
import { IntervalMessages, nextInRotation } from './IntervalMessages.js';

/**
 * Posts the interval messages to chat one at a time, every half hour, cycling through the enabled
 * ones in rotation order — as highlighted announcements where the platform has them (Twitch), as
 * the original bot did. Messages go to every platform that's live; while none is, nothing is
 * posted and the rotation doesn't advance, so the next stream picks up where it left off.
 */
@singleton()
export class IntervalAnnouncer implements IService {
  private timer: NodeJS.Timeout | null = null;
  private logger: Logger;
  private failures: RepeatingFailures;

  constructor(
    eventBus: EventBus,
    private messages: IntervalMessages,
    private streamControl: StreamControlService,
    logger: Logger
  ) {
    this.logger = logger.child({ component: 'IntervalAnnouncer' });
    this.failures = repeatingFailures(eventBus, this.logger, 'Interval messages');
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.announceNext(), ANNOUNCEMENT_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Post the next message in the rotation. Resolves true if it reached at least one platform. */
  async announceNext(): Promise<boolean> {
    try {
      const entry = nextInRotation(this.messages.rotation().messages);
      this.failures.recovered('read');
      if (!entry) return false;

      const { id, message } = entry;
      const result = await this.streamControl.announce(() => message, { highlight: true });
      reportAnnouncement(result, this.failures, 'an interval message');
      if (result.updated.length === 0) return false;

      this.recordPosted(id);
      return true;
    } catch (error) {
      this.failures.failed('read', 'Could not post an interval message.', error);
      return false;
    }
  }

  /** The message did go out, so failing to record that isn't a failure to post it. */
  private recordPosted(id: number): void {
    try {
      this.messages.markPosted(id);
      this.failures.recovered('record');
    } catch (error) {
      this.failures.failed(
        'record',
        'An interval message was posted but not recorded, so it may be posted again next time.',
        error
      );
    }
  }
}
