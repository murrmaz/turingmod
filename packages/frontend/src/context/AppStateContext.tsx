import type {
  CommandHistoryEntry,
  CommandInfo,
  IWebSocketMessage,
  IntegrationInfo,
} from '@turingmod/shared';
import { MessageType } from '@turingmod/shared';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useWebSocketContext } from './WebSocketContext';

/**
 * Application state
 */
export interface AppState {
  /** Integration statuses */
  integrations: IntegrationInfo[];

  /** Available commands */
  commands: CommandInfo[];

  /** Recent command history */
  commandHistory: CommandHistoryEntry[];

  /** System health status */
  isHealthy: boolean;
}

/**
 * Application state context value
 */
export interface AppStateContextValue extends AppState {
  /** Refresh integrations list */
  refreshIntegrations: () => Promise<void>;

  /** Refresh commands list */
  refreshCommands: () => Promise<void>;

  /** Refresh command history */
  refreshCommandHistory: () => Promise<void>;
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
  const { subscribe, sendAndWaitForResponse, isConnected } = useWebSocketContext();
  const [integrations, setIntegrations] = useState<IntegrationInfo[]>([]);
  const [commands, setCommands] = useState<CommandInfo[]>([]);
  const [commandHistory] = useState<CommandHistoryEntry[]>([]);
  const [isHealthy, setIsHealthy] = useState(false);

  // Refresh integrations list
  const refreshIntegrations = useCallback(async () => {
    try {
      const response = await sendAndWaitForResponse<{ integrations: IntegrationInfo[] }>({
        id: crypto.randomUUID(),
        type: MessageType.INTEGRATION_LIST,
        timestamp: Date.now(),
        payload: {},
      });

      if (response.payload.integrations) {
        setIntegrations(response.payload.integrations);
      }
    } catch (error) {
      console.error('[AppState] Failed to refresh integrations', error);
    }
  }, [sendAndWaitForResponse]);

  // Refresh commands list
  const refreshCommands = useCallback(async () => {
    try {
      const response = await sendAndWaitForResponse<{ commands: CommandInfo[] }>({
        id: crypto.randomUUID(),
        type: MessageType.COMMAND_LIST,
        timestamp: Date.now(),
        payload: {},
      });

      if (response.payload.commands) {
        setCommands(response.payload.commands);
      }
    } catch (error) {
      console.error('[AppState] Failed to refresh commands', error);
    }
  }, [sendAndWaitForResponse]);

  // Refresh command history
  const refreshCommandHistory = useCallback(() => {
    // TODO: Implement when backend supports command history message
    console.log('[AppState] Command history refresh not yet implemented');
    return Promise.resolve();
  }, []);

  // Subscribe to real-time updates
  useEffect(() => {
    const unsubscribe = subscribe((message: IWebSocketMessage) => {
      switch (message.type) {
        case MessageType.INTEGRATION_STATUS: {
          // Update integration status (payload is { integration: IntegrationInfo })
          const payload = message.payload as { integration: IntegrationInfo };
          if (payload.integration) {
            setIntegrations((prev) => {
              const updated = [...prev];
              const index = updated.findIndex((i) => i.name === payload.integration.name);
              if (index >= 0) {
                updated[index] = payload.integration;
              } else {
                updated.push(payload.integration);
              }
              return updated;
            });
          }
          break;
        }

        case MessageType.COMMAND_RESULT:
          // Add to command history
          // TODO: Implement command history tracking
          break;

        default:
          break;
      }
    });

    return unsubscribe;
  }, [subscribe]);

  // Initial data load
  useEffect(() => {
    if (isConnected) {
      setIsHealthy(true);
      refreshIntegrations();
      refreshCommands();
      refreshCommandHistory();
    } else {
      setIsHealthy(false);
    }
  }, [isConnected, refreshIntegrations, refreshCommands, refreshCommandHistory]);

  const value: AppStateContextValue = {
    integrations,
    commands,
    commandHistory,
    isHealthy,
    refreshIntegrations,
    refreshCommands,
    refreshCommandHistory,
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
