import type { CommandInfo, IntegrationInfo } from '@turingmod/shared';
import { MessageType } from '@turingmod/shared';
import type { ReactNode } from 'react';
import { createContext, useContext } from 'react';
import { useServerState } from '@/hooks/useServerState';
import { useSubscription } from '@/hooks/useSubscription';

/** The integrations and commands, which most of the console needs. */
export interface AppStateContextValue {
  /** Every integration, kept current by the backend as any of them changes. */
  integrations: IntegrationInfo[];
  /** Show the integrations as a mutation left them, ahead of the subscription's copy. */
  showIntegrations: (integrations: IntegrationInfo[]) => void;
  commands: CommandInfo[];
}

const AppStateContext = createContext<AppStateContextValue | null>(null);

const NO_INTEGRATIONS: IntegrationInfo[] = [];
const NO_COMMANDS: CommandInfo[] = [];

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [integrations, showIntegrations] = useSubscription(
    (trpc, on) => trpc.integrations.watch.subscribe(undefined, on),
    NO_INTEGRATIONS,
    "Couldn't load integrations"
  );
  const commands = useServerState(MessageType.COMMAND_LIST, {
    payload: {},
    initial: NO_COMMANDS,
    onReply: (reply) => reply.commands,
    errorTitle: "Couldn't load commands",
  });

  const value: AppStateContextValue = {
    integrations,
    showIntegrations,
    commands: commands.state,
  };

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

/** The integrations and commands; see AppStateProvider. */
export function useAppState(): AppStateContextValue {
  const context = useContext(AppStateContext);
  if (!context) {
    throw new Error('useAppState must be used within AppStateProvider');
  }
  return context;
}
