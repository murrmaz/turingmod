import Badge from '@cloudscape-design/components/badge';
import Box from '@cloudscape-design/components/box';
import ColumnLayout from '@cloudscape-design/components/column-layout';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { useAppState } from '../../context/AppStateContext';
import { useIntegrationActions } from '../../hooks/useIntegrationActions';
import { useWebSocket } from '../../hooks/useWebSocket';

/**
 * Health monitor component
 * Displays system health and a condensed per-integration status light row.
 * Detailed integration info/actions live on the Integrations page.
 */
export function HealthMonitor() {
  const { isConnected } = useWebSocket();
  const { isHealthy, integrations } = useAppState();
  const { getStatusColor } = useIntegrationActions();

  return (
    <Container header={<Header variant="h2">System Health</Header>}>
      <ColumnLayout columns={3} variant="text-grid">
        <div>
          <Box variant="awsui-key-label">WebSocket Connection</Box>
          <StatusIndicator type={isConnected ? 'success' : 'error'}>
            {isConnected ? 'Connected' : 'Disconnected'}
          </StatusIndicator>
        </div>

        <div>
          <Box variant="awsui-key-label">System Status</Box>
          <StatusIndicator type={isHealthy ? 'success' : 'warning'}>
            {isHealthy ? 'Healthy' : 'Degraded'}
          </StatusIndicator>
        </div>

        <div>
          <Box variant="awsui-key-label">Integrations</Box>
          <SpaceBetween direction="horizontal" size="xs">
            {integrations.map((integration) => (
              <Badge key={integration.name} color={getStatusColor(integration.status)}>
                {integration.name}
              </Badge>
            ))}
          </SpaceBetween>
        </div>
      </ColumnLayout>
    </Container>
  );
}
