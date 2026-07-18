import Badge from '@cloudscape-design/components/badge';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import Popover from '@cloudscape-design/components/popover';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Table from '@cloudscape-design/components/table';
import type { IntegrationInfo } from '@turingmod/shared';
import { useAppState } from '../../context/AppStateContext';
import { useIntegrationActions } from '../../hooks/useIntegrationActions';
import { IntegrationOAuthModals } from '../integrations/IntegrationOAuthModals';

/**
 * Integration status component
 * Displays table of integrations and their statuses
 */
export function IntegrationStatus() {
  const { integrations } = useAppState();
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
    handleNeedsSetup,
    getActionState,
    getStatusColor,
  } = useIntegrationActions();

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
              const {
                isLoading,
                isConnected,
                isStartable,
                isOAuthIntegration,
                needsReauth,
                hasUnmetDependencies,
                missingDependencies,
              } = getActionState(item);

              return (
                <SpaceBetween direction="horizontal" size="xs">
                  {isOAuthIntegration && isStartable && (
                    <Button
                      variant="primary"
                      iconName="unlocked"
                      onClick={() => handleAuthorize(item.name)}
                      disabled={isLoading}
                    >
                      {needsReauth ? 'Reconnect' : 'Authorize'}
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

      <IntegrationOAuthModals
        activeIntegration={activeOAuthIntegration}
        oauthModalVisible={oauthModalVisible}
        setupModalVisible={setupModalVisible}
        onOAuthDismiss={closeOAuthModal}
        onSetupDismiss={closeSetupModal}
        onSetupSuccess={handleSetupSuccess}
        onOAuthSuccess={handleOAuthSuccess}
        onNeedsSetup={handleNeedsSetup}
      />
    </Container>
  );
}
