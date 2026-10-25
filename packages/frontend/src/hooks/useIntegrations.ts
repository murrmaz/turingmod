import { IntegrationStatus, MessageType } from '@turingmod/shared';
import { useCallback } from 'react';
import { useAppState } from '@/context/AppStateContext';
import { useWebSocketContext } from '@/context/WebSocketContext';

/** The integrations, starting and stopping them, and what each is still waiting on. */
export function useIntegrations() {
  const { request } = useWebSocketContext();
  const { integrations, refreshIntegrations } = useAppState();

  const startIntegration = useCallback(
    async (integrationName: string): Promise<void> => {
      await request(MessageType.INTEGRATION_START, { integrationName });
      await refreshIntegrations();
    },
    [request, refreshIntegrations]
  );

  const stopIntegration = useCallback(
    async (integrationName: string): Promise<void> => {
      await request(MessageType.INTEGRATION_STOP, { integrationName });
      await refreshIntegrations();
    },
    [request, refreshIntegrations]
  );

  /** The dependencies of an integration that aren't connected yet. */
  const getMissingDependencies = useCallback(
    (integrationName: string): string[] => {
      const dependencies =
        integrations.find((i) => i.name === integrationName)?.metadata?.dependencies ?? [];
      return dependencies.filter(
        (name) => integrations.find((i) => i.name === name)?.status !== IntegrationStatus.CONNECTED
      );
    },
    [integrations]
  );

  return { integrations, startIntegration, stopIntegration, getMissingDependencies };
}
