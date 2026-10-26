import { useCallback } from 'react';
import { useTrpcConnection } from '@/context/TrpcContext';
import { useWebSocketContext } from '@/context/WebSocketContext';
import type { ConnectionState } from '@/services/WebSocketClient';

/** How far each state is from usable; the console shows the worse of its two connections. */
const SEVERITY: Record<ConnectionState, number> = {
  connected: 0,
  closed: 1,
  connecting: 2,
  reconnecting: 3,
};

/**
 * The console's connection to the backend, as the streamer should see it. The console holds two
 * (the legacy protocol and tRPC, while requests move from one to the other); they reconnect on the
 * same schedule but separately, so it's only connected once both are.
 */
export function useConnection() {
  const legacy = useWebSocketContext();
  const trpc = useTrpcConnection();
  const connectionState =
    SEVERITY[legacy.connectionState] >= SEVERITY[trpc.connectionState]
      ? legacy.connectionState
      : trpc.connectionState;

  const { connect } = legacy;
  const { reconnect } = trpc;
  /** Retry now, on whichever connection is waiting to. */
  const retry = useCallback(() => {
    connect();
    reconnect();
  }, [connect, reconnect]);

  return { connectionState, retry };
}
