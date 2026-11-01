import type { IntegrationInfo } from '@turingmod/shared';
import type { ReactNode } from 'react';
import { createContext, useContext, useMemo } from 'react';
import type { RouterOutputs } from '@/context/trpc-context';
import { useServerQuery } from '@/hooks/useServerQuery';
import { useSubscription } from '@/hooks/useSubscription';

/** One row of `commands.list`, as the backend returns it. */
export type CommandInfo = RouterOutputs['commands']['list'][number];

export interface IntegrationsContextValue {
  /** Every integration, kept current by the backend as any of them changes. */
  integrations: IntegrationInfo[];
  /** Show the integrations as a mutation left them, ahead of the subscription's copy. */
  showIntegrations: (integrations: IntegrationInfo[]) => void;
}

const IntegrationsContext = createContext<IntegrationsContextValue | null>(null);
const CommandsContext = createContext<CommandInfo[] | null>(null);

const NO_INTEGRATIONS: IntegrationInfo[] = [];
const NO_COMMANDS: CommandInfo[] = [];

function IntegrationsProvider({ children }: { children: ReactNode }) {
  const [integrations, showIntegrations] = useSubscription(
    (trpc, on) => trpc.integrations.watch.subscribe(undefined, on),
    NO_INTEGRATIONS,
    "Couldn't load integrations"
  );
  const value = useMemo(
    () => ({ integrations, showIntegrations }),
    [integrations, showIntegrations]
  );
  return <IntegrationsContext.Provider value={value}>{children}</IntegrationsContext.Provider>;
}

function CommandsProvider({ children }: { children: ReactNode }) {
  const { data: commands } = useServerQuery(
    (trpc, input, opts) => trpc.commands.list.query(input, opts),
    { input: {}, initial: NO_COMMANDS, errorTitle: "Couldn't load commands" }
  );
  return <CommandsContext.Provider value={commands}>{children}</CommandsContext.Provider>;
}

/**
 * The integrations and commands, which most of the console needs. Provided separately, since
 * integrations change often and commands hardly ever: what reads one doesn't render for the other.
 */
export function AppStateProvider({ children }: { children: ReactNode }) {
  return (
    <IntegrationsProvider>
      <CommandsProvider>{children}</CommandsProvider>
    </IntegrationsProvider>
  );
}

/** The integrations; see AppStateProvider. To start or stop one, use useIntegrations(). */
export function useIntegrationState(): IntegrationsContextValue {
  const context = useContext(IntegrationsContext);
  if (!context) {
    throw new Error('useIntegrationState must be used within AppStateProvider');
  }
  return context;
}

/** The command table; see AppStateProvider. */
export function useCommandList(): CommandInfo[] {
  const context = useContext(CommandsContext);
  if (!context) {
    throw new Error('useCommandList must be used within AppStateProvider');
  }
  return context;
}
