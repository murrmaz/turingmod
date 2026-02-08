import type { IWebSocketMessage } from '@turingmod/shared';
import { MessageType } from '@turingmod/shared';
import type { Logger } from '../utils/Logger.js';

/**
 * Message handler function type
 */
type MessageHandler = (
  message: IWebSocketMessage,
  clientId: string
) => Promise<IWebSocketMessage | null>;

/**
 * Message router
 * Routes WebSocket messages to appropriate handlers
 */
export class MessageRouter {
  private handlers = new Map<MessageType, MessageHandler>();
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger.child({ component: 'MessageRouter' });
  }

  /**
   * Register a message handler
   */
  registerHandler(type: MessageType, handler: MessageHandler): void {
    if (this.handlers.has(type)) {
      throw new Error(`Handler already registered for type: ${type}`);
    }

    this.handlers.set(type, handler);
    this.logger.debug(`Registered handler for: ${type}`);
  }

  /**
   * Route a message to its handler
   */
  async route(message: IWebSocketMessage, clientId: string): Promise<IWebSocketMessage | null> {
    const handler = this.handlers.get(message.type);

    if (!handler) {
      this.logger.warn(`No handler registered for message type: ${message.type}`);
      return {
        id: message.id,
        type: MessageType.ERROR,
        timestamp: Date.now(),
        payload: {
          code: 'UNKNOWN_MESSAGE_TYPE',
          message: `No handler for message type: ${message.type}`,
          originalMessageId: message.id,
        },
      };
    }

    try {
      return await handler(message, clientId);
    } catch (error) {
      this.logger.error(`Handler error for ${message.type}`, error);
      return {
        id: message.id,
        type: MessageType.ERROR,
        timestamp: Date.now(),
        payload: {
          code: 'HANDLER_ERROR',
          message: error instanceof Error ? error.message : 'Handler execution failed',
          originalMessageId: message.id,
          details: error,
        },
      };
    }
  }
}
