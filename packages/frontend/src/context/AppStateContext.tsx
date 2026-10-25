import type { CommandInfo, IntegrationInfo } from '@turingmod/shared';
import { MessageType } from '@turingmod/shared';
import type { ReactNode } from 'react';
import { createContext, useContext } from 'react';
import { useServerState } from '../hooks/useServerState';

/** The integrations and commands, which most of the console needs. */
export interface AppStateContextValue {
  integrations: IntegrationInfo[];
  commands: CommandInfo[];
  /** Read the integrations again, e.g. after starting one, without waiting for its push. */
  refreshIntegrations: () => Promise<void>;
  refreshCommands: () => Promise<void>;
}

const AppStateContext = createContext<AppStateContextValue | null>(null);

const NO_INTEGRATIONS: IntegrationInfo[] = [];
const NO_COMMANDS: CommandInfo[] = [];

/** One integration's new state, replacing its entry or added if it's new. */
function withIntegration(
  integrations: IntegrationInfo[],
  integration: IntegrationInfo
): IntegrationInfo[] {
  return integrations.some((i) => i.name === integration.name)
    ? integrations.map((i) => (i.name === integration.name ? integration : i))
    : [...integrations, integration];
}

export function AppStateProvider({ children }: { children: ReactNode }) {
  const integrations = useServerState(MessageType.INTEGRATION_LIST, {
    payload: {},
    initial: NO_INTEGRATIONS,
    onReply: (reply) => reply.integrations,
    push: {
      type: MessageType.INTEGRATION_STATUS,
      apply: ({ integration }, current) => withIntegration(current, integration),
    },
    errorTitle: "Couldn't load integrations",
  });
  const commands = useServerState(MessageType.COMMAND_LIST, {
    payload: {},
    initial: NO_COMMANDS,
    onReply: (reply) => reply.commands,
    errorTitle: "Couldn't load commands",
  });

  const value: AppStateContextValue = {
    integrations: integrations.state,
    commands: commands.state,
    refreshIntegrations: integrations.refresh,
    refreshCommands: commands.refresh,
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
