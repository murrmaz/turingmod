import type { IWebSocketMessage } from '@turingmod/shared';
import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { WebSocketClient } from '../services/WebSocketClient';

/**
 * WebSocket context value
 */
export interface WebSocketContextValue {
  /** Whether WebSocket is connected */
  isConnected: boolean;

  /** Send a message */
  send: (message: IWebSocketMessage) => void;

  /** Send a message and wait for response */
  sendAndWaitForResponse: <T = unknown>(
    message: IWebSocketMessage,
    timeout?: number
  ) => Promise<IWebSocketMessage<T>>;

  /** Subscribe to messages */
  subscribe: (handler: (message: IWebSocketMessage) => void) => () => void;

  /** Manually connect */
  connect: () => void;

  /** Manually disconnect */
  disconnect: () => void;
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
 * WebSocket provider
 * Manages WebSocket connection and provides it to children
 */
export function WebSocketProvider({
  children,
  url = 'ws://localhost:8080/ws',
}: WebSocketProviderProps) {
  const [isConnected, setIsConnected] = useState(false);
  const clientRef = useRef<WebSocketClient | null>(null);
  const subscribersRef = useRef<Set<(message: IWebSocketMessage) => void>>(new Set());

  // Initialize WebSocket client
  useEffect(() => {
    const client = new WebSocketClient({ url });

    // Set up event handlers
    client.on('open', () => {
      setIsConnected(true);
    });

    client.on('close', () => {
      setIsConnected(false);
    });

    client.on('error', () => {
      setIsConnected(false);
    });

    client.on('message', (data) => {
      const message = data as IWebSocketMessage;
      // Notify all subscribers
      for (const handler of subscribersRef.current) {
        try {
          handler(message);
        } catch (error) {
          console.error('[WebSocketContext] Subscriber error', error);
        }
      }
    });

    clientRef.current = client;

    // Connect
    client.connect();

    // Cleanup
    return () => {
      client.disconnect();
    };
  }, [url]);

  // Send message
  const send = useCallback((message: IWebSocketMessage) => {
    clientRef.current?.send(message);
  }, []);

  // Send and wait for response
  const sendAndWaitForResponse = useCallback(
    <T = unknown>(message: IWebSocketMessage, timeout?: number) => {
      if (!clientRef.current) {
        return Promise.reject(new Error('WebSocket not initialized'));
      }
      return clientRef.current.sendAndWaitForResponse<T>(message, timeout);
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

  // Manual connect
  const connect = useCallback(() => {
    clientRef.current?.connect();
  }, []);

  // Manual disconnect
  const disconnect = useCallback(() => {
    clientRef.current?.disconnect();
  }, []);

  const value: WebSocketContextValue = {
    isConnected,
    send,
    sendAndWaitForResponse,
    subscribe,
    connect,
    disconnect,
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
