import { singleton } from 'tsyringe';
import { Logger } from '../utils/Logger.js';
import type { EventMap, EventName } from './events.js';

/** A handler for event `K`, receiving that event's payload as declared in `EventMap`. */
export type EventHandler<K extends EventName> = (data: EventMap[K]) => void | Promise<void>;

/** The handler type as stored, once the event name is no longer known statically. */
type StoredHandler = (data: unknown) => void | Promise<void>;

/**
 * Internal event bus for decoupled communication between components
 * Enables loose coupling following the Dependency Inversion Principle
 *
 * Event names and payloads are declared once, in `EventMap` (`events.ts`), so an emitter and its
 * subscribers are checked against the same declaration.
 */
@singleton()
export class EventBus {
  private handlers = new Map<EventName, Set<StoredHandler>>();
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger.child({ component: 'EventBus' });
  }

  /**
   * Subscribe to an event
   * @param event - Event name
   * @param handler - Event handler function
   * @returns Unsubscribe function
   */
  on<K extends EventName>(event: K, handler: EventHandler<K>): () => void {
    let handlers = this.handlers.get(event);
    if (!handlers) {
      handlers = new Set();
      this.handlers.set(event, handlers);
    }
    handlers.add(handler as StoredHandler);

    // Return unsubscribe function
    return () => {
      handlers.delete(handler as StoredHandler);
      // A repeated call may find a newer set here, holding other subscribers.
      if (handlers.size === 0 && this.handlers.get(event) === handlers) {
        this.handlers.delete(event);
      }
    };
  }

  /**
   * Emit an event to all subscribers, and resolve once every handler has settled.
   *
   * Handlers are called in subscription order, but each runs only until its first `await` before
   * the next is called, so async handlers run concurrently: none waits for another to finish, and
   * one must not rely on another having done its work. A handler that throws or rejects is logged
   * and never rejects `emit()` or stops the others.
   */
  async emit<K extends EventName>(event: K, data: EventMap[K]): Promise<void> {
    await Promise.all(this.callHandlers(event, data));
  }

  /**
   * Call every subscriber without waiting for async handlers to settle, for fire-and-forget
   * events. Handlers are called as in `emit()`.
   *
   * An async handler's rejection is still caught and logged: left unhandled it would reach
   * index.ts's `unhandledRejection` handler, which exits the process.
   */
  emitSync<K extends EventName>(event: K, data: EventMap[K]): void {
    void this.callHandlers(event, data);
  }

  /** Call every subscriber, logging any failure. Returns what's left of the async ones; none rejects. */
  private callHandlers<K extends EventName>(event: K, data: EventMap[K]): Promise<void>[] {
    const pending: Promise<void>[] = [];
    for (const handler of this.handlers.get(event) ?? []) {
      try {
        const result = handler(data);
        if (result instanceof Promise) {
          pending.push(
            result.catch((error) => {
              this.logger.error(`Error in asynchronous event handler for ${event}:`, error);
            })
          );
        }
      } catch (error) {
        this.logger.error(`Error in synchronous event handler for ${event}:`, error);
      }
    }
    return pending;
  }

  /** How many handlers are subscribed to an event; tests use it to check for leaked subscriptions. */
  listenerCount(event: EventName): number {
    return this.handlers.get(event)?.size ?? 0;
  }
}
