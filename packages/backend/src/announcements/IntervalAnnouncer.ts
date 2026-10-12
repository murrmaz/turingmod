import { injectable, singleton } from 'tsyringe';
import { IntervalMessageRepository } from '../database/repositories/IntervalMessageRepository.js';
import { StreamControlService } from '../platforms/StreamControlService.js';
import { Logger } from '../utils/Logger.js';

/** How often an interval message is posted, as in the original bot. */
export const ANNOUNCEMENT_INTERVAL_MS = 30 * 60 * 1000;

/**
 * Posts the interval messages to chat one at a time, every half hour, cycling through them in
 * the order they were added — as highlighted announcements where the platform has them (Twitch),
 * as the original bot did. Messages go to every platform that's live; while none is, nothing
 * is posted and the rotation doesn't advance, so the next stream picks up where it left off.
 */
@injectable()
@singleton()
export class IntervalAnnouncer {
  private timer: NodeJS.Timeout | null = null;
  private next = 0;
  private logger: Logger;

  constructor(
    private messages: IntervalMessageRepository,
    private streamControl: StreamControlService,
    logger: Logger
  ) {
    this.logger = logger.child({ component: 'IntervalAnnouncer' });
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
      const messages = await this.messages.list();
      const index = messages.length === 0 ? 0 : this.next % messages.length;
      const entry = messages[index];
      if (!entry) return false;

      const { name, message } = entry;
      const result = await this.streamControl.announce(() => message, { highlight: true });
      for (const failure of result.failures) {
        this.logger.warn(
          `Interval message "${name}" failed on ${failure.platform}: ${failure.error}`
        );
      }
      if (result.updated.length === 0) return false;

      this.next = index + 1;
      return true;
    } catch (error) {
      this.logger.error('Could not post an interval message', error);
      return false;
    }
  }
}
