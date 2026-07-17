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

  const handleAuthorize = useCallback((integrationName: string) => {
    if (!OAUTH_INTEGRATION_REGISTRY[integrationName]) {
      console.error(`No OAuth modal registered for integration "${integrationName}"`);
      return;
    }
    setActiveOAuthIntegration(integrationName);
    setOauthModalVisible(true);
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

  // SetupModal saved credentials -> hand off to the OAuth authorize flow.
  const handleSetupSuccess = useCallback(() => {
    setSetupModalVisible(false);
    setOauthModalVisible(true);
  }, []);

  // OAuthModal discovered credentials aren't configured yet -> hand off to setup.
  const handleNeedsSetup = useCallback(() => {
    setOauthModalVisible(false);
    setSetupModalVisible(true);
  }, []);

  const getActionState = useCallback(
    (item: IntegrationInfo): IntegrationActionState => ({
      isLoading: loadingIntegration === item.name,
      isConnected: item.status === IntegrationStatus.CONNECTED,
      isStartable:
        item.status === IntegrationStatus.DISCONNECTED || item.status === IntegrationStatus.ERROR,
      isOAuthIntegration: Boolean(item.oauth),
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
        return 'red';
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
    handleNeedsSetup,
    getActionState,
    getStatusColor,
  };
}
