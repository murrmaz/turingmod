import { IntegrationStatus } from '@turingmod/shared';
import { useCallback } from 'react';
import { useAppState } from '@/context/AppStateContext';
import { useTrpc } from '@/context/TrpcContext';

/**
 * The integrations, starting, stopping and configuring them, and what each is still waiting on.
 * Each action resolves once the state it left is showing, so a view can stop its spinner then.
 */
export function useIntegrations() {
  const trpc = useTrpc();
  const { integrations, showIntegrations } = useAppState();

  const startIntegration = useCallback(
    async (integrationName: string): Promise<void> => {
      showIntegrations(await trpc.integrations.start.mutate({ integrationName }));
    },
    [trpc, showIntegrations]
  );

  const stopIntegration = useCallback(
    async (integrationName: string): Promise<void> => {
      showIntegrations(await trpc.integrations.stop.mutate({ integrationName }));
    },
    [trpc, showIntegrations]
  );

  const configureIntegration = useCallback(
    async (integrationName: string, config: Record<string, unknown>): Promise<void> => {
      showIntegrations(await trpc.integrations.configure.mutate({ integrationName, config }));
    },
    [trpc, showIntegrations]
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

  return {
    integrations,
    startIntegration,
    stopIntegration,
    configureIntegration,
    getMissingDependencies,
  };
}
