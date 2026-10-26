import { createTRPCClient, createWSClient, type TRPCClient, wsLink } from '@trpc/client';
import type { AppRouter } from '@turingmod/backend/trpc';
import { TRPC_PATH } from '@turingmod/shared';
import type { ReactNode } from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { failWhileDisconnected } from '@/services/trpcLinks';
import { type ConnectionState, reconnectDelay } from '@/services/WebSocketClient';

/** The backend's tRPC router, typed by the backend's own definition of it. */
export type TrpcClient = TRPCClient<AppRouter>;

const TrpcContext = createContext<TrpcClient | null>(null);

/** The tRPC endpoint on the origin that served this page (see defaultWebSocketUrl). */
function trpcUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}${TRPC_PATH}`;
}

/** The tRPC connection, for showing the streamer where it stands. */
export interface TrpcConnection {
  /** As WebSocketClient reports it: `reconnecting` once a connection has failed or dropped. */
  connectionState: ConnectionState;
  /** Try again now instead of waiting for the next attempt. Does nothing while connected. */
  reconnect: () => void;
}

const TrpcConnectionContext = createContext<TrpcConnection | null>(null);

/** Connects to the backend's tRPC endpoint, staying connected until unmounted. */
export function TrpcProvider({ children }: { children: ReactNode }) {
  const [client, setClient] = useState<TrpcClient | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  // Each "retry now" replaces the client, since tRPC's own can't be told to skip its wait.
  const [attempt, setAttempt] = useState(0);
  const everConnected = useRef(false);
  const stateRef = useRef(connectionState);
  stateRef.current = connectionState;

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` is what makes a new client.
  useEffect(() => {
    const wsClient = createWSClient({ url: trpcUrl(), retryDelayMs: reconnectDelay });
    const states = wsClient.connectionState.subscribe({
      next: ({ state, error }) => {
        if (state === 'pending') {
          everConnected.current = true;
          setConnectionState('connected');
        } else if (state === 'idle') {
          setConnectionState('closed');
        } else {
          setConnectionState(error || everConnected.current ? 'reconnecting' : 'connecting');
        }
      },
    });
    const trpc = createTRPCClient<AppRouter>({
      links: [failWhileDisconnected(wsClient), wsLink({ client: wsClient })],
    });
    // Passed as an updater: the client is a proxy over a function, which React would call.
    setClient(() => trpc);
    return () => {
      states.unsubscribe();
      void wsClient.close();
    };
  }, [attempt]);

  const reconnect = useCallback(() => {
    if (stateRef.current !== 'connected') {
      setAttempt((current) => current + 1);
    }
  }, []);
  const connection = useMemo(() => ({ connectionState, reconnect }), [connectionState, reconnect]);

  // Created in the effect so that unmounting closes it; that's only ever the first render.
  if (!client) {
    return null;
  }
  return (
    <TrpcConnectionContext.Provider value={connection}>
      <TrpcContext.Provider value={client}>{children}</TrpcContext.Provider>
    </TrpcConnectionContext.Provider>
  );
}

/** The tRPC client, e.g. `useTrpc().integrations.start.mutate({ integrationName })`. */
export function useTrpc(): TrpcClient {
  const client = useContext(TrpcContext);
  if (!client) {
    throw new Error('useTrpc must be used within TrpcProvider');
  }
  return client;
}

/** The tRPC connection's state. For what the streamer sees, use useConnection(), which covers both. */
export function useTrpcConnection(): TrpcConnection {
  const connection = useContext(TrpcConnectionContext);
  if (!connection) {
    throw new Error('useTrpcConnection must be used within TrpcProvider');
  }
  return connection;
}
