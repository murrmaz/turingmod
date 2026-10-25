import type { IntegrationInfo } from '@turingmod/shared';
import { IntegrationStatus, MessageType } from '@turingmod/shared';
import { useCallback } from 'react';
import { useAppState } from '../context/AppStateContext';
import { useWebSocketContext } from '../context/WebSocketContext';

/**
 * Hook to interact with integrations
 */
export function useIntegrations() {
  const { request } = useWebSocketContext();
  const { integrations, refreshIntegrations } = useAppState();

  /**
   * Start an integration
   */
  const startIntegration = useCallback(
    async (integrationName: string): Promise<void> => {
      await request(MessageType.INTEGRATION_START, { integrationName });
      await refreshIntegrations();
    },
    [request, refreshIntegrations]
  );

  /**
   * Stop an integration
   */
  const stopIntegration = useCallback(
    async (integrationName: string): Promise<void> => {
      await request(MessageType.INTEGRATION_STOP, { integrationName });
      await refreshIntegrations();
    },
    [request, refreshIntegrations]
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
    (name: string): IntegrationStatus | undefined => {
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
        return dep?.status === IntegrationStatus.CONNECTED;
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
        return dep?.status !== IntegrationStatus.CONNECTED;
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
