import type { IntegrationInfo } from '@turingmod/shared';
import { IntegrationStatus } from '@turingmod/shared';
import { useCallback, useState } from 'react';
import { OAUTH_INTEGRATION_REGISTRY } from '../components/integrations/oauthIntegrationRegistry';
import { reconnectTarget } from '../lib/reconnect';
import { useIntegrations } from './useIntegrations';

/**
 * Derived per-item flags a view needs to decide which action buttons to show.
 */
export interface IntegrationActionState {
  isLoading: boolean;
  isConnected: boolean;
  /** Turned on by the streamer, so Stop applies even while it waits on a dependency. */
  isEnabled: boolean;
  isStartable: boolean;
  isOAuthIntegration: boolean;
  needsReauth: boolean;
  hasUnmetDependencies: boolean;
  missingDependencies: string[];
}

/**
 * Shared state and handlers for the "start/stop/authorize an integration" flow, used by the
 * dashboard's Needs attention cards and the Integrations page. Each view renders
 * `IntegrationOAuthModals` with the state this returns.
 */
export function useIntegrationActions() {
  const {
    integrations,
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
      isEnabled: item.enabled,
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
    handleReconnect,
  };
}
