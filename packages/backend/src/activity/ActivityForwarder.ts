import {
  ACTIVITY_EVENT_CATEGORIES,
  ACTIVITY_EVENT_NAMES,
  ActivityCategory,
  type ActivityEventName,
  type ActivityLogEntry,
} from '@turingmod/shared';
import { singleton } from 'tsyringe';
import { EventBus } from '../core/EventBus.js';
import type { EventMap } from '../core/events.js';
import { type IService, Subscriptions } from '../core/ServiceLifecycle.js';
import { ActivityLogRepository } from '../database/repositories/ActivityLogRepository.js';
import { Logger } from '../utils/Logger.js';

/**
 * Events shown in the live tail but not stored, besides chat: they are only worth seeing as they
 * happen, and come in bursts that would push the stream's real history out of the capped log. A
 * device can be chatty, and every break shows and hides a source in every scene on every canvas,
 * which the break's own start and end entries already record.
 */
const LIVE_ONLY_EVENTS: ReadonlySet<ActivityEventName> = new Set([
  'arduino.message',
  'obs.sceneItem.stateChanged',
]);

/**
 * Turns EventBus activity into activity log entries: each goes to the console's live feed
 * (onEntry, which the `activity.feed` subscription listens to) and, for non-chat categories, to
 * the persisted activity_log.
 */
@singleton()
export class ActivityForwarder implements IService {
  private subscriptions = new Subscriptions();
  private entryListeners = new Set<(entry: ActivityLogEntry) => void>();
  private logger: Logger;

  constructor(
    private eventBus: EventBus,
    private repo: ActivityLogRepository,
    logger: Logger
  ) {
    this.logger = logger.child({ component: 'ActivityForwarder' });
  }

  start(): void {
    for (const event of ACTIVITY_EVENT_NAMES) {
      this.subscriptions.add(
        this.eventBus.on(event, (data: unknown) => this.handleEvent(event, data))
      );
    }
  }

  stop(): void {
    this.subscriptions.clear();
  }

  /**
   * Be told of every entry as it's made, chat and live-only events included, which the stored
   * log leaves out. Returns the unsubscribe function.
   */
  onEntry(listener: (entry: ActivityLogEntry) => void): () => void {
    this.entryListeners.add(listener);
    return () => this.entryListeners.delete(listener);
  }

  private handleEvent(event: ActivityEventName, data: unknown): void {
    // A platform that can't be asked isn't known to be offline, and its going unavailable is
    // already recorded as platform.availability; a stream ending is only what a platform reports.
    if (
      event === 'platform.liveState' &&
      (data as EventMap['platform.liveState']).cause === 'unavailable'
    ) {
      return;
    }
    const entry: ActivityLogEntry = {
      id: crypto.randomUUID(),
      event,
      data: this.normalize(event, data),
      timestamp: Date.now(),
    };

    for (const listener of this.entryListeners) {
      listener(entry);
    }

    const category = ACTIVITY_EVENT_CATEGORIES[event];
    if (category === ActivityCategory.CHAT || LIVE_ONLY_EVENTS.has(event)) {
      return;
    }
    if (category === ActivityCategory.COMMAND && entry.data.isSimulation === true) {
      return;
    }

    try {
      this.repo.create(entry);
    } catch (error) {
      this.logger.error('Failed to persist activity log entry', error, { event });
    }
  }

  private normalize(event: ActivityEventName, data: unknown): Record<string, unknown> {
    if (event === 'integration.error') {
      const { name, error } = data as EventMap['integration.error'];
      return { name, message: error.message };
    }
    return data as Record<string, unknown>;
  }
}
