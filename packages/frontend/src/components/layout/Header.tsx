import TopNavigation from '@cloudscape-design/components/top-navigation';
import logo from '../../assets/logo.svg';
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
            src: logo,
            alt: 'TuringMod logo',
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
