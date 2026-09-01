import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import type { YouTubeChatState } from '@turingmod/shared';
import { useYouTubeChat } from '../../hooks/useYouTubeChat';

/** How each lifecycle state reads to the user. */
const STATE_DISPLAY: Record<
  YouTubeChatState,
  { type: 'success' | 'in-progress' | 'stopped'; text: string }
> = {
  idle: { type: 'stopped', text: 'Not connected — waiting for a go-live signal' },
  resolving: { type: 'in-progress', text: 'Looking for an active broadcast…' },
  streaming: { type: 'success', text: 'Connected — receiving chat messages' },
};

/**
 * YouTube chat go-live control.
 *
 * The backend connects automatically when OBS starts streaming. This is the manual path for when
 * OBS isn't in the picture: "Connect chat" tells the backend to go find the active broadcast, which
 * it retries for a couple of minutes because a broadcast doesn't expose its chat id until YouTube
 * has transitioned it to live.
 */
export function YouTubeChatControl() {
  const { state, pending, goLive, goOffline } = useYouTubeChat();
  const display = STATE_DISPLAY[state];

  return (
    <Container
      header={
        <Header
          variant="h2"
          description="Connect to the live chat of your active YouTube broadcast."
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button
                variant="primary"
                loading={pending && state === 'idle'}
                disabled={pending || state !== 'idle'}
                onClick={() => void goLive()}
              >
                Connect chat
              </Button>
              <Button
                loading={pending && state !== 'idle'}
                disabled={pending || state === 'idle'}
                onClick={() => void goOffline()}
              >
                Disconnect
              </Button>
            </SpaceBetween>
          }
        >
          YouTube chat
        </Header>
      }
    >
      <Box>
        <StatusIndicator type={display.type}>{display.text}</StatusIndicator>
      </Box>
    </Container>
  );
}
