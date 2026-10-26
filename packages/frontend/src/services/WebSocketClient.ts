import { createErrorMessage, type ErrorPayload, type IWebSocketMessage } from '@turingmod/shared';

/**
 * Where the connection stands. `connecting` is only the first attempt after connect(); once a
 * connection has failed or dropped, the client is `reconnecting` until one opens again.
 */
export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'closed';

/** WebSocket client configuration */
export interface WebSocketClientConfig {
  /** WebSocket URL */
  url: string;
}

/** The first retry waits this long, doubling each time it fails, up to RECONNECT_MAX_MS. */
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30_000;

/**
 * How long to wait before the next connection attempt, after `failedAttempts` in a row. The
 * tRPC client retries on the same schedule, so the two connections recover together.
 */
export function reconnectDelay(failedAttempts: number): number {
  return Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** failedAttempts);
}

export const NOT_CONNECTED_MESSAGE = 'Not connected to TuringMod';

/**
 * A request got no answer because there was no connection, or it was lost first. Kept apart from
 * an error the backend answered with, since the connection banner already reports this one.
 */
export class ConnectionError extends Error {
  override name = 'ConnectionError';
}

/** Whether a request failed for want of a connection, from either client (tRPC's wraps it). */
export function isConnectionError(error: unknown): boolean {
  return (
    error instanceof ConnectionError ||
    (error instanceof Error && error.cause instanceof ConnectionError)
  );
}

/**
 * WebSocket client wrapper. Once connect() is called it stays connected: a failed or dropped
 * connection is retried with backoff until disconnect().
 *
 * Nothing is queued while disconnected. A request made then is rejected at once, so an action
 * the streamer clicked during an outage never runs later, after they've given up on it; the
 * console re-reads its state on every connect instead.
 */
export class WebSocketClient {
  private ws: WebSocket | null = null;
  private readonly url: string;
  private state: ConnectionState = 'closed';
  private readonly stateHandlers = new Set<(state: ConnectionState) => void>();
  private readonly messageListeners = new Set<(message: IWebSocketMessage) => void>();
  /** Response handlers for in-flight requests, by request id. */
  private readonly pending = new Map<string, (message: IWebSocketMessage) => void>();
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  /** Consecutive attempts that failed, which sets the next retry's delay. */
  private failedAttempts = 0;

  constructor(config: WebSocketClientConfig) {
    this.url = config.url;
  }

  /**
   * Connect, and keep reconnecting after any loss until disconnect(). While a retry is waiting,
   * this tries again immediately.
   */
  connect(): void {
    this.clearRetry();
    if (this.ws) {
      return;
    }
    if (this.state === 'closed') {
      this.setState('connecting');
    }
    this.open();
  }

  /** Close the connection and stop reconnecting. */
  disconnect(): void {
    this.clearRetry();
    const socket = this.ws;
    this.ws = null;
    socket?.close();
    this.rejectPending('Connection closed');
    this.failedAttempts = 0;
    this.setState('closed');
  }

  /**
   * Send a message and wait for its response. Rejects at once when not connected, and when the
   * connection is lost before the response arrives.
   */
  sendAndWaitForResponse<T = unknown>(
    message: IWebSocketMessage,
    timeout = 30000
  ): Promise<IWebSocketMessage<T>> {
    return new Promise((resolve, reject) => {
      const socket = this.ws;
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        reject(new ConnectionError(NOT_CONNECTED_MESSAGE));
        return;
      }

      const timeoutId = setTimeout(() => {
        this.pending.delete(message.id);
        reject(new Error('Request timeout'));
      }, timeout);

      this.pending.set(message.id, (data) => {
        const response = data as IWebSocketMessage<T>;
        clearTimeout(timeoutId);

        // Check if response is an error message
        if (response.type === 'error') {
          const errorPayload = response.payload as ErrorPayload;
          const message = errorPayload?.message || 'Unknown error';
          reject(
            errorPayload?.code === 'CONNECTION_CLOSED'
              ? new ConnectionError(message)
              : new Error(message)
          );
        } else {
          resolve(response);
        }
      });

      socket.send(JSON.stringify(message));
      console.debug('[WebSocket] Message sent', message.type);
    });
  }

  /** Be told of every state change. Returns the unsubscribe function. */
  onStateChange(handler: (state: ConnectionState) => void): () => void {
    this.stateHandlers.add(handler);
    return () => this.stateHandlers.delete(handler);
  }

  /** Hear every message from the server, responses included. Returns the unsubscribe function. */
  onMessage(handler: (message: IWebSocketMessage) => void): () => void {
    this.messageListeners.add(handler);
    return () => this.messageListeners.delete(handler);
  }

  getState(): ConnectionState {
    return this.state;
  }

  isConnected(): boolean {
    return this.state === 'connected';
  }

  private open(): void {
    let socket: WebSocket;
    try {
      socket = new WebSocket(this.url);
    } catch (error) {
      console.error('[WebSocket] Connection failed', error);
      this.handleLoss();
      return;
    }
    this.ws = socket;

    // Each handler first checks that its socket is still the current one, so a socket replaced by
    // disconnect() or a retry can't report its late close against the connection that followed.
    socket.onopen = () => {
      if (this.ws !== socket) {
        return;
      }
      console.log('[WebSocket] Connected');
      this.failedAttempts = 0;
      this.setState('connected');
    };

    socket.onclose = (event) => {
      if (this.ws !== socket) {
        return;
      }
      console.log('[WebSocket] Disconnected', event.code, event.reason);
      this.ws = null;
      this.handleLoss();
    };

    // An error is always followed by close, which does the handling.
    socket.onerror = (event) => {
      if (this.ws === socket) {
        console.error('[WebSocket] Error', event);
      }
    };

    socket.onmessage = (event) => {
      if (this.ws !== socket) {
        return;
      }
      let message: IWebSocketMessage;
      try {
        message = JSON.parse(event.data) as IWebSocketMessage;
      } catch (error) {
        console.error('[WebSocket] Failed to parse message', error);
        return;
      }
      console.debug('[WebSocket] Message received', message.type);

      const handler = this.pending.get(message.id);
      if (handler) {
        this.pending.delete(message.id);
        handler(message);
      }

      for (const listener of this.messageListeners) {
        try {
          listener(message);
        } catch (error) {
          console.error('[WebSocket] Message listener error', error);
        }
      }
    };
  }

  /** A connection failed or dropped: fail what was waiting on it and schedule the next try. */
  private handleLoss(): void {
    this.rejectPending('Connection closed');
    this.setState('reconnecting');
    const delay = reconnectDelay(this.failedAttempts);
    this.failedAttempts += 1;
    console.log(`[WebSocket] Reconnecting in ${delay / 1000}s`);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.open();
    }, delay);
  }

  private clearRetry(): void {
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  private setState(state: ConnectionState): void {
    if (this.state === state) {
      return;
    }
    this.state = state;
    for (const handler of this.stateHandlers) {
      try {
        handler(state);
      } catch (error) {
        console.error('[WebSocket] State handler error', error);
      }
    }
  }

  /** Fail every in-flight request now rather than leaving it to wait out its timeout. */
  private rejectPending(reason: string): void {
    if (this.pending.size === 0) {
      return;
    }
    console.log('[WebSocket] Rejecting pending requests', this.pending.size, reason);
    const pending = [...this.pending.entries()];
    this.pending.clear();
    for (const [id, handler] of pending) {
      handler(createErrorMessage('CONNECTION_CLOSED', reason, id));
    }
  }
}
