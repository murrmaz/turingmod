import {
  ActivityCategory,
  type ActivityLogEntry,
  createEventNotificationMessage,
} from '@turingmod/shared';
import { injectable, singleton } from 'tsyringe';
import { EventBus } from '../core/EventBus.js';
import type { EventName } from '../core/events.js';
import { type IService, Subscriptions } from '../core/ServiceLifecycle.js';
import { ActivityLogRepository } from '../database/repositories/ActivityLogRepository.js';
import { WebSocketServer } from '../server/WebSocketServer.js';
import { Logger } from '../utils/Logger.js';

/** EventBus event name -> activity category. Add new events here as a one-line change. */
const EVENT_CATEGORIES: Partial<Record<EventName, ActivityCategory>> = {
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
  'integration.status': ActivityCategory.STATUS,
  'platform.availability': ActivityCategory.STATUS,
  'integration.error': ActivityCategory.ERROR,
};

/**
 * Forwards EventBus activity to the live tail (broadcast) and, for non-chat categories, to the
 * persisted activity_log.
 */
@injectable()
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
      EventName,
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

  private handleEvent(event: EventName, category: ActivityCategory, data: unknown): void {
    const entry: ActivityLogEntry = {
      id: crypto.randomUUID(),
      category,
      event,
      data: this.normalize(event, data),
      timestamp: Date.now(),
    };

    this.webSocketServer.broadcast(createEventNotificationMessage(entry));

    if (category === ActivityCategory.CHAT) {
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

  private normalize(event: EventName, data: unknown): Record<string, unknown> {
    if (event === 'integration.error') {
      const { name, error } = data as { name: string; error: unknown };
      const errorObj = error as { message?: string } | undefined;
      return {
        name,
        message: errorObj?.message ?? String(error),
      };
    }
    return data as Record<string, unknown>;
  }
}
