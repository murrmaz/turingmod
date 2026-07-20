import type { ErrorPayload, IWebSocketMessage } from '@turingmod/shared';

/**
 * WebSocket event types
 */
export type WebSocketEventType = 'open' | 'close' | 'error' | 'message';

/**
 * WebSocket event handler
 */
export type WebSocketEventHandler = (data?: unknown) => void;

/**
 * WebSocket client configuration
 */
export interface WebSocketClientConfig {
  /** WebSocket URL */
  url: string;
}

/**
 * WebSocket client wrapper
 * Connects only when explicitly told to (initial load or user action) —
 * no background retry/backoff. A failed or dropped connection just reports
 * its state and waits for the next explicit connect() call.
 */
export class WebSocketClient {
  private ws: WebSocket | null = null;
  private config: Required<WebSocketClientConfig>;
  private messageQueue: IWebSocketMessage[] = [];
  private eventHandlers: Map<WebSocketEventType, Set<WebSocketEventHandler>> = new Map();
  private messageHandlers: Map<string, WebSocketEventHandler> = new Map();
  private isConnecting = false;

  constructor(config: WebSocketClientConfig) {
    this.config = {
      url: config.url,
    };

    // Initialize event handler maps
    this.eventHandlers.set('open', new Set());
    this.eventHandlers.set('close', new Set());
    this.eventHandlers.set('error', new Set());
    this.eventHandlers.set('message', new Set());
  }

  /**
   * Connect to WebSocket server
   */
  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN || this.isConnecting) {
      return;
    }

    this.isConnecting = true;

    try {
      this.ws = new WebSocket(this.config.url);

      this.ws.onopen = () => {
        this.isConnecting = false;
        console.log('[WebSocket] Connected');

        // Flush message queue
        this.flushMessageQueue();

        // Emit open event
        this.emit('open');
      };

      this.ws.onclose = (event) => {
        this.isConnecting = false;
        console.log('[WebSocket] Disconnected', event.code, event.reason);

        // Emit close event
        this.emit('close', event);
      };

      this.ws.onerror = (event) => {
        this.isConnecting = false;
        console.error('[WebSocket] Error', event);

        // Emit error event
        this.emit('error', event);
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as IWebSocketMessage;
          console.log('[WebSocket] Message received', message.type);

          // Check for message-specific handler (request/response pattern)
          const handler = this.messageHandlers.get(message.id);
          if (handler) {
            handler(message);
            this.messageHandlers.delete(message.id);
          }

          // Emit message event to all subscribers
          this.emit('message', message);
        } catch (error) {
          console.error('[WebSocket] Failed to parse message', error);
        }
      };
    } catch (error) {
      this.isConnecting = false;
      console.error('[WebSocket] Connection failed', error);
      this.emit('error', error);
    }
  }

  /**
   * Disconnect from WebSocket server
   */
  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Send a message
   * Queues message if not connected
   */
  send(message: IWebSocketMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
      console.log('[WebSocket] Message sent', message.type);
    } else {
      console.log('[WebSocket] Message queued (not connected)', message.type);
      this.messageQueue.push(message);
    }
  }

  /**
   * Send a message and wait for response
   */
  sendAndWaitForResponse<T = unknown>(
    message: IWebSocketMessage,
    timeout = 30000
  ): Promise<IWebSocketMessage<T>> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.messageHandlers.delete(message.id);
        reject(new Error('Request timeout'));
      }, timeout);

      this.messageHandlers.set(message.id, (data?: unknown) => {
        const response = data as IWebSocketMessage<T>;
        clearTimeout(timeoutId);

        // Check if response is an error message
        if (response.type === 'error') {
          const errorPayload = response.payload as ErrorPayload;
          reject(new Error(errorPayload?.message || 'Unknown error'));
        } else {
          resolve(response);
        }
      });

      this.send(message);
    });
  }

  /**
   * Subscribe to WebSocket events
   */
  on(event: WebSocketEventType, handler: WebSocketEventHandler): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.add(handler);
    }
  }

  /**
   * Unsubscribe from WebSocket events
   */
  off(event: WebSocketEventType, handler: WebSocketEventHandler): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.delete(handler);
    }
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Emit event to all subscribers
   */
  private emit(event: WebSocketEventType, data?: unknown): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(data);
        } catch (error) {
          console.error(`[WebSocket] Event handler error (${event})`, error);
        }
      }
    }
  }

  /**
   * Flush queued messages
   */
  private flushMessageQueue(): void {
    if (this.messageQueue.length === 0) {
      return;
    }

    console.log('[WebSocket] Flushing message queue', this.messageQueue.length);

    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      if (message) {
        this.send(message);
      }
    }
  }
}
