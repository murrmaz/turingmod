/**
 * Event handler function type
 */
type EventHandler<T = unknown> = (data: T) => void | Promise<void>;

/**
 * Internal event bus for decoupled communication between components
 * Enables loose coupling following the Dependency Inversion Principle
 */
export class EventBus {
  private handlers = new Map<string, Set<EventHandler>>();

  /**
   * Subscribe to an event
   * @param event - Event name
   * @param handler - Event handler function
   * @returns Unsubscribe function
   */
  on<T = unknown>(event: string, handler: EventHandler<T>): () => void {
    let handlers = this.handlers.get(event);
    if (!handlers) {
      handlers = new Set();
      this.handlers.set(event, handlers);
    }
    handlers.add(handler as EventHandler);

    // Return unsubscribe function
    return () => {
      handlers.delete(handler as EventHandler);
      if (handlers.size === 0) {
        this.handlers.delete(event);
      }
    };
  }

  /**
   * Subscribe to an event for one-time execution
   * Handler will be automatically unsubscribed after first invocation
   */
  once<T = unknown>(event: string, handler: EventHandler<T>): () => void {
    const wrappedHandler = (data: T) => {
      unsubscribe();
      handler(data);
    };

    const unsubscribe = this.on(event, wrappedHandler);
    return unsubscribe;
  }

  /**
   * Unsubscribe from an event
   */
  off(event: string, handler: EventHandler): void {
    const handlers = this.handlers.get(event);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.handlers.delete(event);
      }
    }
  }

  /**
   * Emit an event to all subscribers
   * Handlers are called asynchronously but in order
   */
  async emit<T = unknown>(event: string, data: T): Promise<void> {
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
          promises.push(result);
        }
      } catch (error) {
        console.error(`Error in event handler for ${event}:`, error);
      }
    }

    // Wait for all async handlers to complete
    await Promise.allSettled(promises);
  }

  /**
   * Emit an event synchronously (does not wait for async handlers)
   * Use this for fire-and-forget scenarios
   */
  emitSync<T = unknown>(event: string, data: T): void {
    const handlers = this.handlers.get(event);
    if (!handlers || handlers.size === 0) {
      return;
    }

    for (const handler of handlers) {
      try {
        handler(data);
      } catch (error) {
        console.error(`Error in event handler for ${event}:`, error);
      }
    }
  }

  /**
   * Remove all handlers for a specific event
   */
  removeAllListeners(event?: string): void {
    if (event) {
      this.handlers.delete(event);
    } else {
      this.handlers.clear();
    }
  }

  /**
   * Get count of handlers for an event
   */
  listenerCount(event: string): number {
    return this.handlers.get(event)?.size ?? 0;
  }

  /**
   * Get all registered event names
   */
  eventNames(): string[] {
    return Array.from(this.handlers.keys());
  }
}
