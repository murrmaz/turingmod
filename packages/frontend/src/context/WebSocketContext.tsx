import {
  createMessage,
  type IWebSocketMessage,
  type RequestPayload,
  type RequestType,
  type ResponsePayload,
  WS_PATH,
} from '@turingmod/shared';
import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { type ConnectionState, WebSocketClient } from '../services/WebSocketClient';

/**
 * WebSocket context value
 */
export interface WebSocketContextValue {
  /** Whether WebSocket is connected */
  isConnected: boolean;

  /**
   * Where the connection stands. While `reconnecting`, everything the console shows is as it was
   * when the connection was lost.
   */
  connectionState: ConnectionState;

  /**
   * Send a request and resolve with the payload it's answered with (ResponseTypes in shared), or
   * reject with the message of the error it's answered with instead.
   */
  request: <T extends RequestType>(
    type: T,
    payload: RequestPayload<T>,
    timeout?: number
  ) => Promise<ResponsePayload<T>>;

  /** Subscribe to messages */
  subscribe: (handler: (message: IWebSocketMessage) => void) => () => void;

  /** Retry now, instead of waiting for the next automatic attempt. */
  connect: () => void;
}

const WebSocketContext = createContext<WebSocketContextValue | null>(null);

/**
 * WebSocket provider props
 */
export interface WebSocketProviderProps {
  children: ReactNode;
  url?: string;
}

/**
 * The backend's WebSocket endpoint on the origin that served this page: the backend itself in
 * production, or the Vite dev server in development, which proxies it to the backend. Either way
 * the console never needs to know the backend's port.
 */
function defaultWebSocketUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}${WS_PATH}`;
}

/**
 * WebSocket provider
 * Manages WebSocket connection and provides it to children
 */
export function WebSocketProvider({
  children,
  url = defaultWebSocketUrl(),
}: WebSocketProviderProps) {
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  const clientRef = useRef<WebSocketClient | null>(null);
  const subscribersRef = useRef<Set<(message: IWebSocketMessage) => void>>(new Set());

  useEffect(() => {
    const client = new WebSocketClient({ url });
    client.onStateChange(setConnectionState);
    client.onMessage((message) => {
      for (const handler of subscribersRef.current) {
        try {
          handler(message);
        } catch (error) {
          console.error('[WebSocketContext] Subscriber error', error);
        }
      }
    });
    clientRef.current = client;
    client.connect();

    return () => {
      client.disconnect();
    };
  }, [url]);

  const request = useCallback(
    async <T extends RequestType>(
      type: T,
      payload: RequestPayload<T>,
      timeout?: number
    ): Promise<ResponsePayload<T>> => {
      if (!clientRef.current) {
        throw new Error('WebSocket not initialized');
      }
      // The one place a response is trusted to be what the protocol says it is.
      const response = await clientRef.current.sendAndWaitForResponse<ResponsePayload<T>>(
        createMessage(type, payload),
        timeout
      );
      return response.payload;
    },
    []
  );

  // Subscribe to messages
  const subscribe = useCallback((handler: (message: IWebSocketMessage) => void) => {
    subscribersRef.current.add(handler);

    // Return unsubscribe function
    return () => {
      subscribersRef.current.delete(handler);
    };
  }, []);

  const connect = useCallback(() => {
    clientRef.current?.connect();
  }, []);

  const value: WebSocketContextValue = {
    isConnected: connectionState === 'connected',
    connectionState,
    request,
    subscribe,
    connect,
  };

  return <WebSocketContext.Provider value={value}>{children}</WebSocketContext.Provider>;
}

/**
 * Hook to access WebSocket context
 */
export function useWebSocketContext(): WebSocketContextValue {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error('useWebSocketContext must be used within WebSocketProvider');
  }
  return context;
}
