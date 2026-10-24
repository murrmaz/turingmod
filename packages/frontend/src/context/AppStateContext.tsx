import type { CommandInfo, IntegrationInfo } from '@turingmod/shared';
import { MessageType } from '@turingmod/shared';
import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useWebSocketMessage } from '../hooks/useWebSocket';
import { useWebSocketContext } from './WebSocketContext';

/**
 * Application state
 */
export interface AppState {
  /** Integration statuses */
  integrations: IntegrationInfo[];

  /** Available commands */
  commands: CommandInfo[];
}

/**
 * Application state context value
 */
export interface AppStateContextValue extends AppState {
  /** Refresh integrations list */
  refreshIntegrations: () => Promise<void>;

  /** Refresh commands list */
  refreshCommands: () => Promise<void>;
}

const AppStateContext = createContext<AppStateContextValue | null>(null);

/**
 * Application state provider props
 */
export interface AppStateProviderProps {
  children: ReactNode;
}

/**
 * Application state provider
 * Manages global application state
 */
export function AppStateProvider({ children }: AppStateProviderProps) {
  const { request, isConnected } = useWebSocketContext();
  const [integrations, setIntegrations] = useState<IntegrationInfo[]>([]);
  const [commands, setCommands] = useState<CommandInfo[]>([]);

  // Refresh integrations list
  const refreshIntegrations = useCallback(async () => {
    try {
      const { integrations } = await request(MessageType.INTEGRATION_LIST, {});
      setIntegrations(integrations);
    } catch (error) {
      console.error('[AppState] Failed to refresh integrations', error);
    }
  }, [request]);

  // Refresh commands list
  const refreshCommands = useCallback(async () => {
    try {
      const { commands } = await request(MessageType.COMMAND_LIST, {});
      setCommands(commands);
    } catch (error) {
      console.error('[AppState] Failed to refresh commands', error);
    }
  }, [request]);

  // Real-time updates
  useWebSocketMessage(
    MessageType.INTEGRATION_STATUS,
    useCallback(({ integration }) => {
      setIntegrations((prev) => {
        const updated = [...prev];
        const index = updated.findIndex((i) => i.name === integration.name);
        if (index >= 0) {
          updated[index] = integration;
        } else {
          updated.push(integration);
        }
        return updated;
      });
    }, [])
  );

  // Initial data load
  useEffect(() => {
    if (isConnected) {
      refreshIntegrations();
      refreshCommands();
    }
  }, [isConnected, refreshIntegrations, refreshCommands]);

  const value: AppStateContextValue = {
    integrations,
    commands,
    refreshIntegrations,
    refreshCommands,
  };

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

/**
 * Hook to access application state
 */
export function useAppState(): AppStateContextValue {
  const context = useContext(AppStateContext);
  if (!context) {
    throw new Error('useAppState must be used within AppStateProvider');
  }
  return context;
}
