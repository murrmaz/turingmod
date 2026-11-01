import { render } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { OAuthFlowProvider } from '@/components/integrations/oauth-flow';
import { SimulatorProvider } from '@/components/simulator';
import { AppStateProvider } from '@/context/app-state-context';
import { type Connection, type TrpcClient, TrpcClientProvider } from '@/context/trpc-context';
import type { ConnectionState } from '@/services/connection';
import { FakeSubscription, fakeTrpc, type Procedures } from './fakeTrpc';

export interface ConsoleOptions {
  /** The backend, as fakes (see fakeTrpc). AppStateProvider's are filled in when not given. */
  procedures?: Procedures;
  connectionState?: ConnectionState;
  /** The URL the console opens on, e.g. `/integrations?selected=obs`. */
  route?: string;
}

interface ConsoleProvidersProps {
  client: TrpcClient;
  connection: Connection;
  route: string;
  children: ReactNode;
}

function ConsoleProviders({ client, connection, route, children }: ConsoleProvidersProps) {
  return (
    <TrpcClientProvider client={client} connection={connection}>
      <MemoryRouter initialEntries={[route]}>
        <AppStateProvider>
          <SimulatorProvider>
            <OAuthFlowProvider>{children}</OAuthFlowProvider>
          </SimulatorProvider>
        </AppStateProvider>
      </MemoryRouter>
    </TrpcClientProvider>
  );
}

/**
 * The providers a page runs inside (App.tsx), over a fake backend, as a `wrapper` for render()
 * or renderHook(). Integrations arrive when the test emits them on its own `integrations.watch`;
 * without one, the list stays empty. Commands never arrive unless the test gives `commands.list`.
 */
export function consoleWrapper({
  procedures = {},
  connectionState = 'connected',
  route = '/',
}: ConsoleOptions = {}): (props: { children: ReactNode }) => ReactElement {
  const client = fakeTrpc({
    ...procedures,
    integrations: { watch: new FakeSubscription(), ...procedures.integrations },
    // Never answers, so no state update lands outside the test's act().
    commands: { list: { query: () => new Promise(() => {}) }, ...procedures.commands },
  });
  const connection: Connection = { connectionState, retry: () => {} };
  return ({ children }) => (
    <ConsoleProviders client={client} connection={connection} route={route}>
      {children}
    </ConsoleProviders>
  );
}

/**
 * Just the tRPC providers, for testing a hook against a connection that changes: a new client (as
 * Retry makes) or a new state. Change one, then rerender for the hook to see it.
 */
export function switchableConnection(
  procedures: Procedures,
  connectionState: ConnectionState = 'connected'
) {
  const current = { client: fakeTrpc(procedures), connectionState };
  return {
    wrapper: ({ children }: { children: ReactNode }) => (
      <TrpcClientProvider
        client={current.client}
        connection={{ connectionState: current.connectionState, retry: () => {} }}
      >
        {children}
      </TrpcClientProvider>
    ),
    switchClient: (next: Procedures) => {
      current.client = fakeTrpc(next);
    },
    setConnectionState: (next: ConnectionState) => {
      current.connectionState = next;
    },
  };
}

/** Render part of the console inside its providers (see consoleWrapper). */
export function renderConsole(ui: ReactElement, options?: ConsoleOptions) {
  return render(ui, { wrapper: consoleWrapper(options) });
}

/** The address the console is at, for a test to check where a link or a navigation led. */
export function CurrentLocation() {
  const { pathname, search } = useLocation();
  return <output aria-label="Current location">{pathname + search}</output>;
}
