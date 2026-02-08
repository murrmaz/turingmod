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

  /** Auto-reconnect on disconnect */
  autoReconnect?: boolean;

  /** Reconnect interval in milliseconds */
  reconnectInterval?: number;

  /** Max reconnect attempts (0 = infinite) */
  maxReconnectAttempts?: number;
}

/**
 * WebSocket client wrapper
 * Provides auto-reconnect, message queuing, and event subscription
 */
export class WebSocketClient {
  private ws: WebSocket | null = null;
  private config: Required<WebSocketClientConfig>;
  private reconnectAttempts = 0;
  private reconnectTimer: number | null = null;
  private messageQueue: IWebSocketMessage[] = [];
  private eventHandlers: Map<WebSocketEventType, Set<WebSocketEventHandler>> = new Map();
  private messageHandlers: Map<string, WebSocketEventHandler> = new Map();
  private isConnecting = false;

  constructor(config: WebSocketClientConfig) {
    this.config = {
      url: config.url,
      autoReconnect: config.autoReconnect ?? true,
      reconnectInterval: config.reconnectInterval ?? 3000,
      maxReconnectAttempts: config.maxReconnectAttempts ?? 0,
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
        this.reconnectAttempts = 0;
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

        // Attempt reconnect
        if (this.config.autoReconnect) {
          this.scheduleReconnect();
        }
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

      if (this.config.autoReconnect) {
        this.scheduleReconnect();
      }
    }
  }

  /**
   * Disconnect from WebSocket server
   */
  disconnect(): void {
    this.config.autoReconnect = false;

    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

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

  /**
   * Schedule reconnect attempt
   */
  private scheduleReconnect(): void {
    if (
      this.config.maxReconnectAttempts > 0 &&
      this.reconnectAttempts >= this.config.maxReconnectAttempts
    ) {
      console.log('[WebSocket] Max reconnect attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.config.reconnectInterval * Math.min(this.reconnectAttempts, 5);

    console.log(`[WebSocket] Scheduling reconnect attempt ${this.reconnectAttempts} in ${delay}ms`);

    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
}
