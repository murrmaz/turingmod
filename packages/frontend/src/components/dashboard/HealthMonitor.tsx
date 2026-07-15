import Box from '@cloudscape-design/components/box';
import ColumnLayout from '@cloudscape-design/components/column-layout';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { IntegrationStatus } from '@turingmod/shared';
import { useAppState } from '../../context/AppStateContext';
import { useWebSocket } from '../../hooks/useWebSocket';

/**
 * Health monitor component
 * Displays system health status
 */
export function HealthMonitor() {
  const { isConnected } = useWebSocket();
  const { isHealthy, integrations } = useAppState();

  const connectedIntegrations = integrations.filter(
    (i) => i.status === IntegrationStatus.CONNECTED
  ).length;
  const totalIntegrations = integrations.length;

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
          <Box variant="awsui-key-label">Active Integrations</Box>
          <Box>
            {connectedIntegrations} / {totalIntegrations}
          </Box>
        </div>
      </ColumnLayout>
    </Container>
  );
}
