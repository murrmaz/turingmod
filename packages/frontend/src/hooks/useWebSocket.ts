import type { IWebSocketMessage, MessageType } from '@turingmod/shared';
import { useEffect } from 'react';
import { useWebSocketContext } from '../context/WebSocketContext';

/**
 * Hook to use WebSocket
 * Convenience wrapper around WebSocketContext
 */
export function useWebSocket() {
  return useWebSocketContext();
}

/**
 * Hook to subscribe to specific message types
 */
export function useWebSocketMessage<T = unknown>(
  messageType: MessageType,
  handler: (message: IWebSocketMessage<T>) => void
) {
  const { subscribe } = useWebSocketContext();

  useEffect(() => {
    const unsubscribe = subscribe((message) => {
      if (message.type === messageType) {
        handler(message as IWebSocketMessage<T>);
      }
    });

    return unsubscribe;
  }, [subscribe, messageType, handler]);
}
