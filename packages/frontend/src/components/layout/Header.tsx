import TopNavigation from '@cloudscape-design/components/top-navigation';
import logo from '../../assets/logo.svg';
import { useWebSocket } from '../../hooks/useWebSocket';

/**
 * Application header
 * Displays app title and connection status
 */
export function Header() {
  const { isConnected, connect } = useWebSocket();

  return (
    <div id="app-header">
      {!isConnected && (
        <div
          role="alert"
          style={{
            backgroundColor: '#8b0000',
            color: '#ffffff',
            textAlign: 'center',
            padding: '6px 16px',
            fontWeight: 'bold',
            fontSize: '14px',
          }}
        >
          Disconnected from server — some features are unavailable
        </div>
      )}
      <TopNavigation
        identity={{
          href: '/',
          title: 'TuringMod',
          logo: {
            src: logo,
            alt: 'TuringMod logo',
          },
        }}
        utilities={
          isConnected
            ? [
                {
                  type: 'button',
                  text: 'Connected',
                  iconName: 'status-positive',
                  disableUtilityCollapse: true,
                },
              ]
            : // No background retry — reconnecting is always an explicit user action,
              // surfaced as its own labeled button rather than an implicit click target.
              // The red banner above already conveys "disconnected," so no need to
              // restate it here too.
              [
                {
                  type: 'button' as const,
                  text: 'Reconnect',
                  iconName: 'refresh' as const,
                  variant: 'primary-button' as const,
                  onClick: connect,
                },
              ]
        }
      />
    </div>
  );
}
