import {
  ACTIVITY_EVENT_CATEGORIES,
  ACTIVITY_EVENT_NAMES,
  ActivityCategory,
  type ActivityData,
  type ActivityEventName,
  type ActivityLogEntry,
  ActivityLogEntrySchema,
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

const asIs = <T>(payload: T): T => payload;

/**
 * What each event records, as JSON can carry it; null for one not worth recording. An EventMap
 * payload that drifts from its entry's is a compile error here. A field only EventMap has isn't
 * recorded: parsing the entry drops it.
 */
const TO_ACTIVITY_DATA: {
  [E in ActivityEventName]: (payload: EventMap[E]) => ActivityData<E> | null;
} = {
  'chat.message': asIs,
  'command.executed': asIs,
  'twitch.follow': ({ followDate, ...rest }) => ({
    ...rest,
    followDate: followDate.toISOString(),
  }),
  'twitch.subscribe': asIs,
  'twitch.raid': asIs,
  'twitch.cheer': asIs,
  'twitch.ad.break': ({ startedAt, ...rest }) => ({
    ...rest,
    startedAt: startedAt.toISOString(),
  }),
  'stream.break.started': asIs,
  'stream.break.ended': asIs,
  'twitch.channelPoint.redemption': ({ redeemedAt, ...rest }) => ({
    ...rest,
    redeemedAt: redeemedAt.toISOString(),
  }),
  'obs.scene.changed': asIs,
  'obs.stream.stateChanged': asIs,
  'obs.record.stateChanged': asIs,
  'obs.sceneItem.stateChanged': asIs,
  'arduino.message': asIs,
  'integration.status': asIs,
  'platform.availability': asIs,
  // A platform that can't be asked isn't known to be offline, and its going unavailable is
  // already recorded as platform.availability; a stream ending is only what a platform reports.
  'platform.liveState': (payload) => (payload.cause === 'unavailable' ? null : payload),
  'integration.error': ({ name, error }) => ({ name, message: error.message }),
};

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
      this.forward(event);
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

  private forward<E extends ActivityEventName>(event: E): void {
    this.subscriptions.add(
      this.eventBus.on(event, (payload: EventMap[E]) => {
        const data = TO_ACTIVITY_DATA[event](payload);
        if (data !== null) {
          this.record(event, data);
        }
      })
    );
  }

  /** Checked here, so that what's sent and stored is what a read of it expects. */
  private record(event: ActivityEventName, data: unknown): void {
    const parsed = ActivityLogEntrySchema.safeParse({
      id: crypto.randomUUID(),
      event,
      data,
      timestamp: Date.now(),
    });
    if (!parsed.success) {
      this.logger.error('Activity event does not fit its entry schema', parsed.error, { event });
      return;
    }
    const entry = parsed.data;

    for (const listener of this.entryListeners) {
      listener(entry);
    }

    if (ACTIVITY_EVENT_CATEGORIES[event] === ActivityCategory.CHAT || LIVE_ONLY_EVENTS.has(event)) {
      return;
    }
    if (entry.event === 'command.executed' && entry.data.isSimulation) {
      return;
    }

    try {
      this.repo.create(entry);
    } catch (error) {
      this.logger.error('Failed to persist activity log entry', error, { event });
    }
  }
}
