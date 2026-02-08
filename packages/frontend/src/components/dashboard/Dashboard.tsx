import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { HealthMonitor } from './HealthMonitor';
import { IntegrationStatus } from './IntegrationStatus';

/**
 * Dashboard page
 * Displays system overview and integration statuses
 */
export function Dashboard() {
  return (
    <SpaceBetween size="l">
      <Container header={<Header variant="h1">Dashboard</Header>}>
        Welcome to TuringMod - Your Twitch Streamer Tool
      </Container>

      <HealthMonitor />

      <IntegrationStatus />
    </SpaceBetween>
  );
}
