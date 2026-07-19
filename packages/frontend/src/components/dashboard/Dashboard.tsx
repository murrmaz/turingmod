import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { HealthMonitor } from './HealthMonitor';

/**
 * Dashboard page
 * Displays system overview and a condensed integration status summary.
 * Detailed integration info/actions live on the Integrations page.
 */
export function Dashboard() {
  return (
    <SpaceBetween size="l">
      <Container header={<Header variant="h1">Dashboard</Header>}>
        Welcome to TuringMod — The Swiss Army Knife of Stream Automation. Twitch, Spotify, Discord,
        OBS, Arduino — it does a little bit of everything.
      </Container>

      <HealthMonitor />
    </SpaceBetween>
  );
}
