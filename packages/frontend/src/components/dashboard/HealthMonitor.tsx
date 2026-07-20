import Badge from '@cloudscape-design/components/badge';
import Box from '@cloudscape-design/components/box';
import ColumnLayout from '@cloudscape-design/components/column-layout';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import type { IntegrationInfo } from '@turingmod/shared';
import { useAppState } from '../../context/AppStateContext';
import { useIntegrationActions } from '../../hooks/useIntegrationActions';

/**
 * Badge for a single integration's light-row entry. This row is a glance
 * surface (hover, not click), so the explanation rides on the native
 * `title` attribute rather than a Cloudscape Popover — Popover only opens
 * on click, which doesn't fit a row of plain, non-interactive badges.
 */
function IntegrationLight({ integration }: { integration: IntegrationInfo }) {
  const { getActionState, getStatusColor } = useIntegrationActions();
  const { hasUnmetDependencies, missingDependencies } = getActionState(integration);

  let title: string | undefined;
  if (integration.errorMessage) {
    title = integration.errorMessage;
  } else if (hasUnmetDependencies) {
    title = `Requires: ${missingDependencies.join(', ')}`;
  }

  return (
    <Badge
      color={getStatusColor(integration.status)}
      nativeAttributes={title ? { title } : undefined}
    >
      {integration.name}
    </Badge>
  );
}

/**
 * Health monitor component
 * Displays system health and a condensed per-integration status light row.
 * Detailed integration info/actions live on the Integrations page. Connection
 * status itself lives only in the header (visible on every page); repeating
 * it here would just be the same fact shown twice.
 */
export function HealthMonitor() {
  const { isHealthy, integrations } = useAppState();

  return (
    <Container header={<Header variant="h2">System Health</Header>}>
      <ColumnLayout columns={2} variant="text-grid">
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
              <IntegrationLight key={integration.name} integration={integration} />
            ))}
          </SpaceBetween>
        </div>
      </ColumnLayout>
    </Container>
  );
}
