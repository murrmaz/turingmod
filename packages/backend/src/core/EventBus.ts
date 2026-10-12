import { injectable, singleton } from 'tsyringe';
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
@injectable()
@singleton()
export class EventBus {
  private handlers = new Map<EventName, Set<StoredHandler>>();
  logger: Logger;

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
      if (handlers.size === 0) {
        this.handlers.delete(event);
      }
    };
  }

  /**
   * Subscribe to an event for one-time execution
   * Handler will be automatically unsubscribed after first invocation
   */
  once<K extends EventName>(event: K, handler: EventHandler<K>): () => void {
    const wrappedHandler = (data: EventMap[K]) => {
      unsubscribe();
      return handler(data);
    };

    const unsubscribe = this.on(event, wrappedHandler);
    return unsubscribe;
  }

  /**
   * Unsubscribe from an event
   */
  off<K extends EventName>(event: K, handler: EventHandler<K>): void {
    const handlers = this.handlers.get(event);
    if (handlers) {
      handlers.delete(handler as StoredHandler);
      if (handlers.size === 0) {
        this.handlers.delete(event);
      }
    }
  }

  /**
   * Emit an event to all subscribers
   * Handlers are called asynchronously but in order
   */
  async emit<K extends EventName>(event: K, data: EventMap[K]): Promise<void> {
    const handlers = this.handlers.get(event);
    if (!handlers || handlers.size === 0) {
      return;
    }

    // Execute handlers in order
    const promises: Promise<void>[] = [];
    for (const handler of handlers) {
      try {
        const result = handler(data);
        if (result instanceof Promise) {
          promises.push(
            result.catch((error) => {
              this.logger.error(`Error in asynchronous event handler for ${event}:`, error);
            })
          );
        }
      } catch (error) {
        this.logger.error(`Error in asynchronous event handler for ${event}:`, error);
      }
    }

    // Wait for all async handlers to complete
    await Promise.all(promises);
  }

  /**
   * Emit an event synchronously (does not wait for async handlers)
   * Use this for fire-and-forget scenarios
   *
   * An async handler's rejection is still caught and logged: left unhandled it would reach
   * index.ts's `unhandledRejection` handler, which exits the process.
   */
  emitSync<K extends EventName>(event: K, data: EventMap[K]): void {
    const handlers = this.handlers.get(event);
    if (!handlers || handlers.size === 0) {
      return;
    }

    for (const handler of handlers) {
      try {
        const result = handler(data);
        if (result instanceof Promise) {
          result.catch((error) => {
            this.logger.error(`Error in asynchronous event handler for ${event}:`, error);
          });
        }
      } catch (error) {
        this.logger.error(`Error in synchronous event handler for ${event}:`, error);
      }
    }
  }

  /**
   * Remove all handlers for a specific event
   */
  removeAllListeners(event?: EventName): void {
    if (event) {
      this.handlers.delete(event);
    } else {
      this.handlers.clear();
    }
  }

  /**
   * Get count of handlers for an event
   */
  listenerCount(event: EventName): number {
    return this.handlers.get(event)?.size ?? 0;
  }

  /**
   * Get all registered event names
   */
  eventNames(): EventName[] {
    return Array.from(this.handlers.keys());
  }
}
