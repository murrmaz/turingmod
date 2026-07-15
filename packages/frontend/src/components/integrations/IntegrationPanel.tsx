import Badge from '@cloudscape-design/components/badge';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Cards from '@cloudscape-design/components/cards';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import Popover from '@cloudscape-design/components/popover';
import SpaceBetween from '@cloudscape-design/components/space-between';
import type { IntegrationInfo } from '@turingmod/shared';
import { IntegrationStatus } from '@turingmod/shared';
import { useState } from 'react';
import { useIntegrations } from '../../hooks/useIntegrations';
import { SpotifyOAuthModal } from './SpotifyOAuthModal';
import { SpotifySetupModal } from './SpotifySetupModal';
import { TwitchOAuthModal } from './TwitchOAuthModal';
import { TwitchSetupModal } from './TwitchSetupModal';

/**
 * Integration panel component
 * Displays and manages integrations
 */
export function IntegrationPanel() {
  const {
    integrations,
    startIntegration,
    stopIntegration,
    refreshIntegrations,
    areDependenciesMet,
    getMissingDependencies,
  } = useIntegrations();
  const [loadingIntegration, setLoadingIntegration] = useState<string | null>(null);

  // Twitch modal state
  const [twitchOauthVisible, setTwitchOauthVisible] = useState(false);
  const [twitchSetupVisible, setTwitchSetupVisible] = useState(false);

  // Spotify modal state
  const [spotifyOauthVisible, setSpotifyOauthVisible] = useState(false);
  const [spotifySetupVisible, setSpotifySetupVisible] = useState(false);

  const handleAuthorize = (integrationName: string) => {
    if (integrationName === 'twitch-auth') {
      setTwitchOauthVisible(true);
    } else if (integrationName === 'spotify-auth') {
      setSpotifyOauthVisible(true);
    }
  };

  const handleOAuthSuccess = () => {
    refreshIntegrations();
  };

  const handleStart = async (integrationName: string) => {
    setLoadingIntegration(integrationName);
    try {
      await startIntegration(integrationName);
    } catch (error) {
      console.error('Failed to start integration', error);
    } finally {
      setLoadingIntegration(null);
    }
  };

  const handleStop = async (integrationName: string) => {
    setLoadingIntegration(integrationName);
    try {
      await stopIntegration(integrationName);
    } catch (error) {
      console.error('Failed to stop integration', error);
    } finally {
      setLoadingIntegration(null);
    }
  };

  const getStatusColor = (status: IntegrationStatus): 'blue' | 'green' | 'red' | 'grey' => {
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
  };

  return (
    <SpaceBetween size="l">
      <Container
        header={
          <Header variant="h1" description="Manage your platform integrations">
            Integrations
          </Header>
        }
      >
        <Cards
          cardDefinition={{
            header: (item: IntegrationInfo) => (
              <SpaceBetween size="xs" direction="horizontal">
                <Box variant="h3">{item.name}</Box>
                <Badge color={getStatusColor(item.status)}>{item.status}</Badge>
              </SpaceBetween>
            ),
            sections: [
              {
                id: 'status',
                content: (item: IntegrationInfo) => (
                  <SpaceBetween size="s">
                    <div>
                      <Box variant="awsui-key-label">Status</Box>
                      <div>{item.status}</div>
                    </div>
                    {item.lastConnected && (
                      <div>
                        <Box variant="awsui-key-label">Last Connected</Box>
                        <div>{new Date(item.lastConnected).toLocaleString()}</div>
                      </div>
                    )}
                    {item.errorMessage && (
                      <div>
                        <Box variant="awsui-key-label">Last Error</Box>
                        <Box color="text-status-error">{item.errorMessage}</Box>
                      </div>
                    )}
                  </SpaceBetween>
                ),
              },
              {
                id: 'actions',
                content: (item: IntegrationInfo) => {
                  const hasUnmetDependencies = !areDependenciesMet(item.name);
                  const missingDeps = getMissingDependencies(item.name);
                  const isOAuthIntegration = Boolean(item.oauth);
                  const isStartable =
                    item.status === IntegrationStatus.DISCONNECTED ||
                    item.status === IntegrationStatus.ERROR;

                  return (
                    <SpaceBetween size="xs" direction="horizontal">
                      {item.status === IntegrationStatus.CONNECTED ? (
                        <Button
                          onClick={() => handleStop(item.name)}
                          loading={loadingIntegration === item.name}
                        >
                          Stop
                        </Button>
                      ) : isOAuthIntegration ? (
                        isStartable && (
                          <Button
                            variant="primary"
                            iconName="unlocked"
                            onClick={() => handleAuthorize(item.name)}
                            disabled={loadingIntegration === item.name}
                          >
                            Authorize
                          </Button>
                        )
                      ) : (
                        <>
                          {hasUnmetDependencies ? (
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
                              <Button variant="primary" disabled={true}>
                                Start
                              </Button>
                            </Popover>
                          ) : (
                            <Button
                              variant="primary"
                              onClick={() => handleStart(item.name)}
                              loading={loadingIntegration === item.name}
                            >
                              Start
                            </Button>
                          )}
                        </>
                      )}
                    </SpaceBetween>
                  );
                },
              },
            ],
          }}
          items={integrations}
          cardsPerRow={[{ cards: 1 }, { minWidth: 500, cards: 2 }]}
          loadingText="Loading integrations..."
          empty={
            <Box textAlign="center" color="inherit">
              <b>No integrations available</b>
              <Box padding={{ bottom: 's' }} variant="p" color="inherit">
                Integrations will appear here once the backend is connected.
              </Box>
            </Box>
          }
        />
      </Container>

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
    </SpaceBetween>
  );
}
