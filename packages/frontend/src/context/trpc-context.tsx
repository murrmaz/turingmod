import { createTRPCClient, createWSClient, type TRPCClient, wsLink } from '@trpc/client';
import type { inferRouterInputs, inferRouterOutputs } from '@trpc/server';
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
import { type ConnectionState, reconnectDelay } from '@/services/connection';
import { failWhileDisconnected } from '@/services/trpcLinks';

/** The backend's tRPC router, typed by the backend's own definition of it. */
export type TrpcClient = TRPCClient<AppRouter>;

/** Each procedure's input, e.g. `RouterInputs['data']['queryRows']`. */
export type RouterInputs = inferRouterInputs<AppRouter>;

/** What each procedure answers with, e.g. `RouterOutputs['commands']['simulate']`. */
export type RouterOutputs = inferRouterOutputs<AppRouter>;

const TrpcContext = createContext<TrpcClient | null>(null);

/**
 * The tRPC endpoint on the origin that served this page: the backend itself in production, or the
 * Vite dev server in development, which proxies it to the backend. Either way the console never
 * needs to know the backend's port.
 */
function trpcUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}${TRPC_PATH}`;
}

/** The console's connection to the backend, for showing the streamer where it stands. */
export interface Connection {
  /** `reconnecting` once a connection has failed or dropped, until one opens again. */
  connectionState: ConnectionState;
  /** Try again now instead of waiting for the next attempt. Does nothing while connected. */
  retry: () => void;
}

const ConnectionContext = createContext<Connection | null>(null);

/** Connects to the backend's tRPC endpoint, staying connected until unmounted. */
export function TrpcProvider({ children }: { children: ReactNode }) {
  const [client, setClient] = useState<TrpcClient | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  // Each "retry now" replaces the client, since tRPC's own can't be told to skip its wait.
  const [attempt, setAttempt] = useState(0);
  const everConnected = useRef(false);

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

  const retry = useCallback(() => {
    if (connectionState !== 'connected') {
      setAttempt((current) => current + 1);
    }
  }, [connectionState]);
  const connection = useMemo(() => ({ connectionState, retry }), [connectionState, retry]);

  // Created in the effect so that unmounting closes it; that's only ever the first render.
  if (!client) {
    return null;
  }
  return (
    <TrpcClientProvider client={client} connection={connection}>
      {children}
    </TrpcClientProvider>
  );
}

/**
 * Gives everything below it this client and connection: TrpcProvider's real ones, or a test's
 * fake client (`testing/fakeTrpc.ts`), which needs no WebSocket.
 */
export function TrpcClientProvider({
  client,
  connection,
  children,
}: {
  client: TrpcClient;
  connection: Connection;
  children: ReactNode;
}) {
  return (
    <ConnectionContext.Provider value={connection}>
      <TrpcContext.Provider value={client}>{children}</TrpcContext.Provider>
    </ConnectionContext.Provider>
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

/**
 * Where the console's connection to the backend stands, and Retry now. Nothing the console shows
 * is current while it's `reconnecting`.
 */
export function useConnection(): Connection {
  const connection = useContext(ConnectionContext);
  if (!connection) {
    throw new Error('useConnection must be used within TrpcProvider');
  }
  return connection;
}
