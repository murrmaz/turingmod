import type { IntegrationInfo } from '@turingmod/shared';
import { IntegrationStatus } from '@turingmod/shared';
import { useCallback, useState } from 'react';
import { OAUTH_INTEGRATION_REGISTRY } from '../components/integrations/oauthIntegrationRegistry';
import { useIntegrations } from './useIntegrations';

export type IntegrationBadgeColor = 'blue' | 'green' | 'red' | 'grey';

/**
 * Derived per-item flags a view needs to decide which action buttons to show.
 */
export interface IntegrationActionState {
  isLoading: boolean;
  isConnected: boolean;
  isStartable: boolean;
  isOAuthIntegration: boolean;
  needsReauth: boolean;
  hasUnmetDependencies: boolean;
  missingDependencies: string[];
}

/**
 * Shared state and handlers for the "start/stop/authorize an integration"
 * flow, used by both the dashboard's table view (IntegrationStatus) and the
 * integrations page's card view (IntegrationPanel). Each view is still
 * responsible for its own layout (Table vs Cards) and copy — this hook only
 * owns the parts that were previously duplicated verbatim between them.
 */
export function useIntegrationActions() {
  const {
    startIntegration,
    stopIntegration,
    refreshIntegrations,
    areDependenciesMet,
    getMissingDependencies,
  } = useIntegrations();

  const [loadingIntegration, setLoadingIntegration] = useState<string | null>(null);
  const [activeOAuthIntegration, setActiveOAuthIntegration] = useState<string | null>(null);
  const [oauthModalVisible, setOauthModalVisible] = useState(false);
  const [setupModalVisible, setSetupModalVisible] = useState(false);

  // Without client credentials there's nothing to authorize with yet, so
  // connecting starts at the setup dialog, which hands off to the OAuth modal.
  const handleAuthorize = useCallback((integration: IntegrationInfo) => {
    if (!OAUTH_INTEGRATION_REGISTRY[integration.name]) {
      console.error(`No OAuth modal registered for integration "${integration.name}"`);
      return;
    }
    setActiveOAuthIntegration(integration.name);
    if (integration.oauth?.configured) {
      setOauthModalVisible(true);
    } else {
      setSetupModalVisible(true);
    }
  }, []);

  const handleStart = useCallback(
    async (integrationName: string) => {
      setLoadingIntegration(integrationName);
      try {
        await startIntegration(integrationName);
      } catch (error) {
        console.error(`Failed to start ${integrationName}`, error);
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
        console.error(`Failed to stop ${integrationName}`, error);
      } finally {
        setLoadingIntegration(null);
      }
    },
    [stopIntegration]
  );

  // OAuthModal exchanges the code and dismisses itself; the view just needs
  // the integration list refreshed to pick up the new CONNECTED status.
  const handleOAuthSuccess = useCallback(() => {
    refreshIntegrations();
  }, [refreshIntegrations]);

  const closeOAuthModal = useCallback(() => setOauthModalVisible(false), []);
  const closeSetupModal = useCallback(() => setSetupModalVisible(false), []);

  // SetupModal saved credentials -> hand off to the OAuth authorize flow, and
  // refresh so the integration now reports itself configured.
  const handleSetupSuccess = useCallback(() => {
    setSetupModalVisible(false);
    setOauthModalVisible(true);
    refreshIntegrations();
  }, [refreshIntegrations]);

  const getActionState = useCallback(
    (item: IntegrationInfo): IntegrationActionState => ({
      isLoading: loadingIntegration === item.name,
      isConnected: item.status === IntegrationStatus.CONNECTED,
      isStartable:
        item.status === IntegrationStatus.DISCONNECTED ||
        item.status === IntegrationStatus.ERROR ||
        item.status === IntegrationStatus.NEEDS_REAUTH ||
        item.status === IntegrationStatus.BLOCKED,
      isOAuthIntegration: Boolean(item.oauth),
      needsReauth: item.status === IntegrationStatus.NEEDS_REAUTH,
      hasUnmetDependencies: !areDependenciesMet(item.name),
      missingDependencies: getMissingDependencies(item.name),
    }),
    [loadingIntegration, areDependenciesMet, getMissingDependencies]
  );

  const getStatusColor = useCallback((status: IntegrationStatus): IntegrationBadgeColor => {
    switch (status) {
      case IntegrationStatus.CONNECTED:
        return 'green';
      case IntegrationStatus.CONNECTING:
        return 'blue';
      case IntegrationStatus.ERROR:
      case IntegrationStatus.NEEDS_REAUTH:
        return 'red';
      // Not a failure of this integration — a prerequisite is off — so it
      // reads as inactive rather than broken.
      case IntegrationStatus.BLOCKED:
        return 'grey';
      default:
        return 'grey';
    }
  }, []);

  return {
    activeOAuthIntegration,
    oauthModalVisible,
    setupModalVisible,
    handleAuthorize,
    handleStart,
    handleStop,
    handleOAuthSuccess,
    closeOAuthModal,
    closeSetupModal,
    handleSetupSuccess,
    getActionState,
    getStatusColor,
  };
}
