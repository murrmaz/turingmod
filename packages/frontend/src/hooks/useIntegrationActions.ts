import type { IntegrationInfo } from '@turingmod/shared';
import { IntegrationStatus } from '@turingmod/shared';
import { useCallback, useState } from 'react';
import { useOAuthFlow } from '@/components/integrations/OAuthFlow';
import { reconnectTarget } from '@/lib/reconnect';
import { reportActionError } from '@/lib/reportError';
import { useIntegrations } from './useIntegrations';

/**
 * Derived per-item flags a view needs to decide which action buttons to show.
 */
export interface IntegrationActionState {
  isLoading: boolean;
  isConnected: boolean;
  /** Turned on by the streamer, so Stop applies even while it waits on a dependency. */
  isEnabled: boolean;
  isOAuthIntegration: boolean;
  needsReauth: boolean;
  hasUnmetDependencies: boolean;
  missingDependencies: string[];
}

/**
 * Shared state and handlers for the "start/stop/authorize an integration" flow, used by the
 * dashboard's Needs attention cards and the Integrations page. Authorizing opens the app-wide
 * OAuth dialogs (OAuthFlowProvider).
 */
export function useIntegrationActions() {
  const { integrations, startIntegration, stopIntegration, getMissingDependencies } =
    useIntegrations();

  const { authorize: handleAuthorize } = useOAuthFlow();
  const [loadingIntegration, setLoadingIntegration] = useState<string | null>(null);

  const handleStart = useCallback(
    async (integrationName: string) => {
      setLoadingIntegration(integrationName);
      try {
        await startIntegration(integrationName);
      } catch (error) {
        reportActionError(`Couldn't start ${integrationName}`, error);
      } finally {
        setLoadingIntegration(null);
      }
    },
    [startIntegration]
  );

  const handleStop = useCallback(
    async (integrationName: string) => {
      setLoadingIntegration(integrationName);
      try {
        await stopIntegration(integrationName);
      } catch (error) {
        reportActionError(`Couldn't stop ${integrationName}`, error);
      } finally {
        setLoadingIntegration(null);
      }
    },
    [stopIntegration]
  );

  const getActionState = useCallback(
    (item: IntegrationInfo): IntegrationActionState => {
      const missingDependencies = getMissingDependencies(item.name);
      return {
        isLoading: loadingIntegration === item.name,
        isConnected: item.status === IntegrationStatus.CONNECTED,
        isEnabled: item.enabled,
        isOAuthIntegration: Boolean(item.oauth),
        needsReauth: item.status === IntegrationStatus.NEEDS_REAUTH,
        hasUnmetDependencies: missingDependencies.length > 0,
        missingDependencies,
      };
    },
    [loadingIntegration, getMissingDependencies]
  );

  // Fix a broken integration the one way that can: authorize again where OAuth is involved
  // (on its auth integration, for an API integration that lost its grant), otherwise start it.
  const handleReconnect = useCallback(
    (integration: IntegrationInfo) => {
      const target = reconnectTarget(integration, integrations);
      if (target.oauth) {
        handleAuthorize(target);
      } else {
        void handleStart(target.name);
      }
    },
    [integrations, handleAuthorize, handleStart]
  );

  return {
    handleAuthorize,
    handleStart,
    handleStop,
    getActionState,
    handleReconnect,
  };
}
