import { singleton } from 'tsyringe';
import { EventBus } from '../../../core/EventBus.js';
import {
  type IntervalMessage,
  IntervalMessageRepository,
} from '../../../database/repositories/IntervalMessageRepository.js';

/** The messages in rotation order, and which is posted next. */
export interface IntervalRotation {
  messages: IntervalMessage[];
  /** Null when no message is enabled, so nothing would be posted. */
  nextId: number | null;
}

/**
 * The enabled message after the one posted most recently, wrapping around; the first enabled
 * one if none has been posted. Worked out from what's stored rather than kept as a position, so
 * it survives a restart, and adding, moving or deleting messages can't make the rotation skip one.
 */
export function nextInRotation(messages: readonly IntervalMessage[]): IntervalMessage | undefined {
  let latest = -1;
  let latestAt = Number.NEGATIVE_INFINITY;
  for (const [index, { lastPostedAt }] of messages.entries()) {
    if (lastPostedAt !== null && lastPostedAt > latestAt) {
      latest = index;
      latestAt = lastPostedAt;
    }
  }
  const following = [...messages.slice(latest + 1), ...messages.slice(0, latest + 1)];
  return following.find((message) => message.enabled);
}

/**
 * The interval messages the streamer manages on the console and IntervalAnnouncer posts.
 * Everything that changes one goes through here, so `intervalMessages.changed`, and through it
 * the console (`intervalMessages.watch`), hears of every change. Writing to a message that's gone
 * (another console deleted it) throws, with the message the console shows.
 */
@singleton()
export class IntervalMessages {
  constructor(
    private eventBus: EventBus,
    private messages: IntervalMessageRepository
  ) {}

  rotation(): IntervalRotation {
    const messages = this.messages.list();
    return { messages, nextId: nextInRotation(messages)?.id ?? null };
  }

  add(message: string): void {
    this.messages.add(message);
    this.changed();
  }

  updateText(id: number, message: string): void {
    this.require(this.messages.updateText(id, message));
    this.changed();
  }

  setEnabled(id: number, enabled: boolean): void {
    this.require(this.messages.setEnabled(id, enabled));
    this.changed();
  }

  move(id: number, direction: 'up' | 'down'): void {
    this.require(this.messages.move(id, direction));
    this.changed();
  }

  /** Delete the messages with these ids; ones already gone are skipped. */
  remove(ids: readonly number[]): void {
    if (this.messages.remove(ids) > 0) {
      this.changed();
    }
  }

  /** Record that a message was posted just now, which moves the rotation on. */
  markPosted(id: number): void {
    // A message deleted while it was being posted has nothing to record.
    if (this.messages.markPosted(id, Date.now())) {
      this.changed();
    }
  }

  private require(found: boolean): void {
    if (!found) {
      throw new Error('That interval message no longer exists.');
    }
  }

  private changed(): void {
    this.eventBus.emitSync('intervalMessages.changed', undefined);
  }
}
