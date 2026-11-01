import { useCallback } from 'react';
import { useAppState } from '@/context/app-state-context';
import { useTrpc } from '@/context/trpc-context';

/**
 * The integrations, and starting, stopping and configuring them.
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

  return {
    integrations,
    startIntegration,
    stopIntegration,
    configureIntegration,
  };
}
