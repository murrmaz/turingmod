import type { ServerMessageType, ServerPayloads } from '@turingmod/shared';
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
 * Hook to subscribe to one type of server message, with its payload typed by ServerPayloads.
 * Hears answers to requests as well as pushed messages.
 */
export function useWebSocketMessage<T extends ServerMessageType>(
  messageType: T,
  handler: (payload: ServerPayloads[T]) => void
) {
  const { subscribe } = useWebSocketContext();

  useEffect(() => {
    const unsubscribe = subscribe((message) => {
      if (message.type === messageType) {
        handler(message.payload as ServerPayloads[T]);
      }
    });

    return unsubscribe;
  }, [subscribe, messageType, handler]);
}
