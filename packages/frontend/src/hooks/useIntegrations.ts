import type { IntegrationInfo } from '@turingmod/shared';
import { MessageType } from '@turingmod/shared';
import { useCallback } from 'react';
import { useAppState } from '../context/AppStateContext';
import { useWebSocketContext } from '../context/WebSocketContext';

/**
 * Hook to interact with integrations
 */
export function useIntegrations() {
  const { sendAndWaitForResponse } = useWebSocketContext();
  const { integrations, refreshIntegrations } = useAppState();

  /**
   * Start an integration
   */
  const startIntegration = useCallback(
    async (integrationName: string): Promise<void> => {
      try {
        await sendAndWaitForResponse({
          id: crypto.randomUUID(),
          type: MessageType.INTEGRATION_START,
          timestamp: Date.now(),
          payload: {
            integrationName,
          },
        });

        // Refresh integrations list
        await refreshIntegrations();
      } catch (error) {
        console.error(`[useIntegrations] Failed to start ${integrationName}`, error);
        throw error;
      }
    },
    [sendAndWaitForResponse, refreshIntegrations]
  );

  /**
   * Stop an integration
   */
  const stopIntegration = useCallback(
    async (integrationName: string): Promise<void> => {
      try {
        await sendAndWaitForResponse({
          id: crypto.randomUUID(),
          type: MessageType.INTEGRATION_STOP,
          timestamp: Date.now(),
          payload: {
            integrationName,
          },
        });

        // Refresh integrations list
        await refreshIntegrations();
      } catch (error) {
        console.error(`[useIntegrations] Failed to stop ${integrationName}`, error);
        throw error;
      }
    },
    [sendAndWaitForResponse, refreshIntegrations]
  );

  /**
   * Get integration by name
   */
  const getIntegration = useCallback(
    (name: string): IntegrationInfo | undefined => {
      return integrations.find((i) => i.name === name);
    },
    [integrations]
  );

  /**
   * Get integration status
   */
  const getIntegrationStatus = useCallback(
    (name: string): string | undefined => {
      return getIntegration(name)?.status;
    },
    [getIntegration]
  );

  /**
   * Check if integration dependencies are met
   */
  const areDependenciesMet = useCallback(
    (integrationName: string): boolean => {
      const integration = getIntegration(integrationName);
      if (!integration) return false;

      const dependencies = integration.metadata?.dependencies || [];
      if (dependencies.length === 0) return true;

      // All dependencies must be connected
      return dependencies.every((depName) => {
        const dep = getIntegration(depName);
        return dep?.status === 'connected';
      });
    },
    [getIntegration]
  );

  /**
   * Get missing dependencies for an integration
   */
  const getMissingDependencies = useCallback(
    (integrationName: string): string[] => {
      const integration = getIntegration(integrationName);
      if (!integration) return [];

      const dependencies = integration.metadata?.dependencies || [];

      return dependencies.filter((depName) => {
        const dep = getIntegration(depName);
        return dep?.status !== 'connected';
      });
    },
    [getIntegration]
  );

  return {
    integrations,
    startIntegration,
    stopIntegration,
    getIntegration,
    getIntegrationStatus,
    refreshIntegrations,
    areDependenciesMet,
    getMissingDependencies,
  };
}
