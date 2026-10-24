import {
  ActivityCategory,
  type ActivityEventName,
  type ActivityLogEntry,
  createEventNotificationMessage,
} from '@turingmod/shared';
import { singleton } from 'tsyringe';
import { EventBus } from '../core/EventBus.js';
import type { EventMap } from '../core/events.js';
import { type IService, Subscriptions } from '../core/ServiceLifecycle.js';
import { ActivityLogRepository } from '../database/repositories/ActivityLogRepository.js';
import { WebSocketServer } from '../server/WebSocketServer.js';
import { Logger } from '../utils/Logger.js';

/**
 * Each recorded event's activity category. The events themselves are ACTIVITY_EVENTS in shared,
 * which the console describes too: a new one goes there first, and then needs a line here.
 */
const EVENT_CATEGORIES: Record<ActivityEventName, ActivityCategory> = {
  'chat.message': ActivityCategory.CHAT,
  'command.executed': ActivityCategory.COMMAND,
  'twitch.follow': ActivityCategory.EVENT,
  'twitch.subscribe': ActivityCategory.EVENT,
  'twitch.raid': ActivityCategory.EVENT,
  'twitch.cheer': ActivityCategory.EVENT,
  'twitch.stream.online': ActivityCategory.EVENT,
  'twitch.stream.offline': ActivityCategory.EVENT,
  'twitch.ad.break': ActivityCategory.EVENT,
  'stream.break.started': ActivityCategory.EVENT,
  'stream.break.ended': ActivityCategory.EVENT,
  'twitch.channelPoint.redemption': ActivityCategory.EVENT,
  'obs.scene.changed': ActivityCategory.EVENT,
  'obs.stream.stateChanged': ActivityCategory.EVENT,
  'obs.record.stateChanged': ActivityCategory.EVENT,
  'obs.sceneItem.stateChanged': ActivityCategory.EVENT,
  'arduino.message': ActivityCategory.EVENT,
  'integration.status': ActivityCategory.STATUS,
  'platform.availability': ActivityCategory.STATUS,
  'integration.error': ActivityCategory.ERROR,
};

/**
 * Events shown in the live tail but not stored, besides chat: what a device sends is only worth
 * seeing as it happens, and a chatty one would otherwise push the stream's real history out of
 * the capped log.
 */
const LIVE_ONLY_EVENTS: ReadonlySet<ActivityEventName> = new Set(['arduino.message']);

/**
 * Forwards EventBus activity to the live tail (broadcast) and, for non-chat categories, to the
 * persisted activity_log.
 */
@singleton()
export class ActivityForwarder implements IService {
  private subscriptions = new Subscriptions();
  private logger: Logger;

  constructor(
    private eventBus: EventBus,
    private webSocketServer: WebSocketServer,
    private repo: ActivityLogRepository,
    logger: Logger
  ) {
    this.logger = logger.child({ component: 'ActivityForwarder' });
  }

  start(): void {
    for (const [event, category] of Object.entries(EVENT_CATEGORIES) as [
      ActivityEventName,
      ActivityCategory,
    ][]) {
      this.subscriptions.add(
        this.eventBus.on(event, (data: unknown) => this.handleEvent(event, category, data))
      );
    }
  }

  stop(): void {
    this.subscriptions.clear();
  }

  private handleEvent(event: ActivityEventName, category: ActivityCategory, data: unknown): void {
    const entry: ActivityLogEntry = {
      id: crypto.randomUUID(),
      category,
      event,
      data: this.normalize(event, data),
      timestamp: Date.now(),
    };

    this.webSocketServer.broadcast(createEventNotificationMessage(entry));

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
