import Badge from '@cloudscape-design/components/badge';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Cards from '@cloudscape-design/components/cards';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import Popover from '@cloudscape-design/components/popover';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { IntegrationGroup, type IntegrationInfo } from '@turingmod/shared';
import { useIntegrationActions } from '../../hooks/useIntegrationActions';
import { useIntegrations } from '../../hooks/useIntegrations';
import { IntegrationOAuthModals } from './IntegrationOAuthModals';

/** Human-readable labels for IntegrationGroup, and the stable order groups are displayed in. */
const INTEGRATION_GROUP_LABELS: Record<IntegrationGroup, string> = {
  [IntegrationGroup.TWITCH]: 'Twitch',
  [IntegrationGroup.YOUTUBE]: 'YouTube',
  [IntegrationGroup.SPOTIFY]: 'Spotify',
};

const INTEGRATION_GROUP_ORDER: IntegrationGroup[] = [
  IntegrationGroup.TWITCH,
  IntegrationGroup.YOUTUBE,
  IntegrationGroup.SPOTIFY,
];

/**
 * Integration panel component
 * Displays and manages integrations
 */
export function IntegrationPanel() {
  const { integrations } = useIntegrations();
  const {
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
  } = useIntegrationActions();

  const ungroupedIntegrations = integrations.filter((item) => !item.group);
  const groupedIntegrations = INTEGRATION_GROUP_ORDER.map((group) => ({
    group,
    items: integrations.filter((item) => item.group === group),
  })).filter(({ items }) => items.length > 0);

  const cardDefinition = {
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
          const {
            isLoading,
            isConnected,
            isEnabled,
            isStartable,
            isOAuthIntegration,
            needsReauth,
            hasUnmetDependencies,
            missingDependencies,
          } = getActionState(item);

          return (
            <SpaceBetween size="xs" direction="horizontal">
              {isConnected || (isEnabled && !isOAuthIntegration) ? (
                <Button
                  variant="normal"
                  iconName="status-negative"
                  onClick={() => handleStop(item.name)}
                  loading={isLoading}
                >
                  Stop
                </Button>
              ) : isOAuthIntegration ? (
                isStartable && (
                  <Button
                    variant="primary"
                    iconName="unlocked"
                    onClick={() => handleAuthorize(item)}
                    disabled={isLoading}
                  >
                    {needsReauth ? 'Reconnect' : 'Authorize'}
                  </Button>
                )
              ) : hasUnmetDependencies ? (
                <Popover
                  dismissButton={false}
                  position="top"
                  size="medium"
                  triggerType="custom"
                  content={
                    <Box padding="s">
                      <SpaceBetween size="xs">
                        <Box variant="strong">Waits for dependencies</Box>
                        <Box variant="p">
                          Once started, this integration runs as soon as these connect:
                        </Box>
                        <ul style={{ margin: 0, paddingLeft: '20px' }}>
                          {missingDependencies.map((dep) => (
                            <li key={dep}>
                              <strong>{dep}</strong>
                            </li>
                          ))}
                        </ul>
                      </SpaceBetween>
                    </Box>
                  }
                >
                  <Button
                    variant="primary"
                    iconName="status-positive"
                    onClick={() => handleStart(item.name)}
                    loading={isLoading}
                  >
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
              )}
            </SpaceBetween>
          );
        },
      },
    ],
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
        <SpaceBetween size="l">
          {groupedIntegrations.map(({ group, items }) => (
            <SpaceBetween key={group} size="s">
              <Header variant="h2">{INTEGRATION_GROUP_LABELS[group]}</Header>
              <Cards
                cardDefinition={cardDefinition}
                items={items}
                cardsPerRow={[{ cards: 1 }, { minWidth: 500, cards: 2 }]}
                loadingText="Loading integrations..."
              />
            </SpaceBetween>
          ))}

          {(ungroupedIntegrations.length > 0 || groupedIntegrations.length === 0) && (
            <SpaceBetween size="s">
              {groupedIntegrations.length > 0 && <Header variant="h2">Other</Header>}
              <Cards
                cardDefinition={cardDefinition}
                items={ungroupedIntegrations}
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
            </SpaceBetween>
          )}
        </SpaceBetween>
      </Container>

      <IntegrationOAuthModals
        activeIntegration={activeOAuthIntegration}
        oauthModalVisible={oauthModalVisible}
        setupModalVisible={setupModalVisible}
        onOAuthDismiss={closeOAuthModal}
        onSetupDismiss={closeSetupModal}
        onSetupSuccess={handleSetupSuccess}
        onOAuthSuccess={handleOAuthSuccess}
      />
    </SpaceBetween>
  );
}
