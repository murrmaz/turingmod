import {
  createErrorMessage,
  type IWebSocketMessage,
  messageOf,
  REQUEST_PAYLOAD_SCHEMAS,
  type RequestPayload,
  type RequestType,
} from '@turingmod/shared';
import { injectable, singleton } from 'tsyringe';
import { z } from 'zod';
import { Logger } from '../utils/Logger.js';

/** Handles one request type, given a payload that has already passed its schema. */
export type RequestHandler<T extends RequestType> = (
  message: IWebSocketMessage<RequestPayload<T>>,
  clientId: string
) => Promise<IWebSocketMessage | null>;

/**
 * REQUEST_PAYLOAD_SCHEMAS seen as a mapped type, which is what lets TypeScript relate the schema
 * at a generic `type` to that type's payload. The assignment checks every entry.
 */
const PAYLOAD_SCHEMAS: { [K in RequestType]: z.ZodType<RequestPayload<K>> } =
  REQUEST_PAYLOAD_SCHEMAS;

type RegisteredHandler = (
  message: IWebSocketMessage,
  clientId: string
) => Promise<IWebSocketMessage | null>;

/**
 * Message router
 * Routes WebSocket messages to appropriate handlers, after checking each payload against its
 * request type's schema (REQUEST_PAYLOAD_SCHEMAS). A handler only ever sees a valid payload; a
 * malformed one is answered with INVALID_PAYLOAD naming the fields that were wrong.
 */
@injectable()
@singleton()
export class MessageRouter {
  private handlers = new Map<RequestType, RegisteredHandler>();
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger.child({ component: 'MessageRouter' });
  }

  /**
   * Register a message handler
   */
  registerHandler<T extends RequestType>(type: T, handler: RequestHandler<T>): void {
    if (this.handlers.has(type)) {
      throw new Error(`Handler already registered for type: ${type}`);
    }

    const schema = PAYLOAD_SCHEMAS[type];
    this.handlers.set(type, (message, clientId) => {
      const parsed = schema.safeParse(message.payload);
      if (!parsed.success) {
        this.logger.warn(`Rejected a malformed ${type} payload`, { issues: parsed.error.issues });
        return Promise.resolve(
          createErrorMessage(
            'INVALID_PAYLOAD',
            `Malformed ${type} payload: ${z.prettifyError(parsed.error)}`,
            message.id
          )
        );
      }
      return handler({ ...message, payload: parsed.data }, clientId);
    });
    this.logger.debug(`Registered handler for: ${type}`);
  }

  /**
   * Route a message to its handler
   */
  async route(message: IWebSocketMessage, clientId: string): Promise<IWebSocketMessage | null> {
    const handler = this.isRequestType(message.type) ? this.handlers.get(message.type) : undefined;

    if (!handler) {
      this.logger.warn(`No handler registered for message type: ${message.type}`);
      return createErrorMessage(
        'UNKNOWN_MESSAGE_TYPE',
        `No handler for message type: ${message.type}`,
        message.id
      );
    }

    try {
      return await handler(message, clientId);
    } catch (error) {
      this.logger.error(`Handler error for ${message.type}`, error);
      return createErrorMessage(
        'HANDLER_ERROR',
        messageOf(error, 'Handler execution failed'),
        message.id
      );
    }
  }

  private isRequestType(type: string): type is RequestType {
    return Object.hasOwn(REQUEST_PAYLOAD_SCHEMAS, type);
  }
}
