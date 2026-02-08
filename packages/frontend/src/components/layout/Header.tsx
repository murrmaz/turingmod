import TopNavigation from '@cloudscape-design/components/top-navigation';
import { useWebSocket } from '../../hooks/useWebSocket';

/**
 * Application header
 * Displays app title and connection status
 */
export function Header() {
  const { isConnected } = useWebSocket();

  return (
    <div id="app-header">
      <TopNavigation
        identity={{
          href: '/',
          title: 'TuringMod',
          logo: {
            src: '',
            alt: 'TuringMod',
          },
        }}
        utilities={[
          {
            type: 'button',
            text: isConnected ? 'Connected' : 'Disconnected',
            iconName: isConnected ? 'status-positive' : 'status-negative',
          },
        ]}
      />
    </div>
  );
}
