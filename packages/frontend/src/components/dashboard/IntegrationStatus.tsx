import Badge from '@cloudscape-design/components/badge';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import Popover from '@cloudscape-design/components/popover';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Table from '@cloudscape-design/components/table';
import type { IntegrationInfo } from '@turingmod/shared';
import { useState } from 'react';
import { useAppState } from '../../context/AppStateContext';
import { useIntegrations } from '../../hooks/useIntegrations';
import { SpotifyOAuthModal } from '../integrations/SpotifyOAuthModal';
import { SpotifySetupModal } from '../integrations/SpotifySetupModal';
import { TwitchOAuthModal } from '../integrations/TwitchOAuthModal';
import { TwitchSetupModal } from '../integrations/TwitchSetupModal';

/**
 * Integration status component
 * Displays table of integrations and their statuses
 */
export function IntegrationStatus() {
  const { integrations, refreshIntegrations } = useAppState();
  const { startIntegration, stopIntegration, areDependenciesMet, getMissingDependencies } =
    useIntegrations();

  // Twitch modal state
  const [twitchOauthVisible, setTwitchOauthVisible] = useState(false);
  const [twitchSetupVisible, setTwitchSetupVisible] = useState(false);

  // Spotify modal state
  const [spotifyOauthVisible, setSpotifyOauthVisible] = useState(false);
  const [spotifySetupVisible, setSpotifySetupVisible] = useState(false);

  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const getStatusColor = (status: string): 'blue' | 'green' | 'red' | 'grey' => {
    switch (status) {
      case 'connected':
        return 'green';
      case 'connecting':
        return 'blue';
      case 'error':
        return 'red';
      default:
        return 'grey';
    }
  };

  const handleAuthorize = (integrationName: string) => {
    if (integrationName === 'twitch-auth') {
      setTwitchOauthVisible(true);
    } else if (integrationName === 'spotify-auth') {
      setSpotifyOauthVisible(true);
    }
  };

  const handleStart = async (integrationName: string) => {
    setActionLoading(integrationName);
    try {
      await startIntegration(integrationName);
    } catch (error) {
      console.error(`Failed to start ${integrationName}`, error);
    } finally {
      setActionLoading(null);
    }
  };

  const handleStop = async (integrationName: string) => {
    setActionLoading(integrationName);
    try {
      await stopIntegration(integrationName);
    } catch (error) {
      console.error(`Failed to stop ${integrationName}`, error);
    } finally {
      setActionLoading(null);
    }
  };

  const handleOAuthSuccess = () => {
    refreshIntegrations();
  };

  return (
    <Container header={<Header variant="h2">Integration Status</Header>}>
      <Table
        columnDefinitions={[
          {
            id: 'name',
            header: 'Integration',
            cell: (item: IntegrationInfo) => item.name,
            sortingField: 'name',
          },
          {
            id: 'status',
            header: 'Status',
            cell: (item: IntegrationInfo) => (
              <Badge color={getStatusColor(item.status)}>{item.status}</Badge>
            ),
            sortingField: 'status',
          },
          {
            id: 'lastConnected',
            header: 'Last Connected',
            cell: (item: IntegrationInfo) =>
              item.lastConnected ? new Date(item.lastConnected).toLocaleString() : 'Never',
          },
          {
            id: 'error',
            header: 'Error',
            cell: (item: IntegrationInfo) => item.errorMessage || '-',
          },
          {
            id: 'actions',
            header: 'Actions',
            cell: (item: IntegrationInfo) => {
              const isLoading = actionLoading === item.name;
              const isConnected = item.status === 'connected';
              const isStartable = item.status === 'disconnected' || item.status === 'error';
              const isOAuthIntegration =
                item.name === 'twitch-auth' || item.name === 'spotify-auth';

              // Check dependencies
              const hasUnmetDependencies = !areDependenciesMet(item.name);
              const missingDeps = getMissingDependencies(item.name);

              return (
                <SpaceBetween direction="horizontal" size="xs">
                  {isOAuthIntegration && isStartable && (
                    <Button
                      variant="primary"
                      iconName="unlocked"
                      onClick={() => handleAuthorize(item.name)}
                      disabled={isLoading}
                    >
                      Authorize
                    </Button>
                  )}
                  {!isOAuthIntegration &&
                    isStartable &&
                    (hasUnmetDependencies ? (
                      <Popover
                        dismissButton={false}
                        position="top"
                        size="medium"
                        triggerType="custom"
                        content={
                          <Box padding="s">
                            <SpaceBetween size="xs">
                              <Box variant="strong">Dependencies Required</Box>
                              <Box variant="p">
                                This integration requires the following to be connected first:
                              </Box>
                              <ul style={{ margin: 0, paddingLeft: '20px' }}>
                                {missingDeps.map((dep) => (
                                  <li key={dep}>
                                    <strong>{dep}</strong>
                                  </li>
                                ))}
                              </ul>
                            </SpaceBetween>
                          </Box>
                        }
                      >
                        <Button variant="primary" iconName="status-positive" disabled={true}>
                          Start
                        </Button>
                      </Popover>
                    ) : (
                      <Button
                        variant="primary"
                        iconName="status-positive"
                        onClick={() => handleStart(item.name)}
                        loading={isLoading}
                      >
                        Start
                      </Button>
                    ))}
                  {isConnected && (
                    <Button
                      variant="normal"
                      iconName="status-negative"
                      onClick={() => handleStop(item.name)}
                      loading={isLoading}
                    >
                      Stop
                    </Button>
                  )}
                </SpaceBetween>
              );
            },
          },
        ]}
        items={integrations}
        loadingText="Loading integrations..."
        empty={
          <Box textAlign="center" color="inherit">
            <b>No integrations configured</b>
            <Box padding={{ bottom: 's' }} variant="p" color="inherit">
              Go to the Integrations page to configure your integrations.
            </Box>
          </Box>
        }
      />

      {/* Twitch OAuth modals */}
      <TwitchSetupModal
        visible={twitchSetupVisible}
        onDismiss={() => setTwitchSetupVisible(false)}
        onSuccess={() => setTwitchOauthVisible(true)}
      />

      <TwitchOAuthModal
        visible={twitchOauthVisible}
        onDismiss={() => setTwitchOauthVisible(false)}
        onSuccess={handleOAuthSuccess}
        onNeedsSetup={() => {
          setTwitchOauthVisible(false);
          setTwitchSetupVisible(true);
        }}
      />

      {/* Spotify OAuth modals */}
      <SpotifySetupModal
        visible={spotifySetupVisible}
        onDismiss={() => setSpotifySetupVisible(false)}
        onSuccess={() => setSpotifyOauthVisible(true)}
      />

      <SpotifyOAuthModal
        visible={spotifyOauthVisible}
        onDismiss={() => setSpotifyOauthVisible(false)}
        onSuccess={handleOAuthSuccess}
        onNeedsSetup={() => {
          setSpotifyOauthVisible(false);
          setSpotifySetupVisible(true);
        }}
      />
    </Container>
  );
}
