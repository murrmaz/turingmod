import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import FormField from '@cloudscape-design/components/form-field';
import Input from '@cloudscape-design/components/input';
import Link from '@cloudscape-design/components/link';
import Modal from '@cloudscape-design/components/modal';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { type IntegrationConfigurePayload, MessageType, createMessage } from '@turingmod/shared';
import { useState } from 'react';
import { useWebSocketContext } from '../../context/WebSocketContext';

export interface TwitchSetupModalProps {
  visible: boolean;
  onDismiss: () => void;
  onSuccess: () => void;
}

/**
 * Twitch Setup Modal
 * Allows user to configure Twitch Client ID and Client Secret
 */
export function TwitchSetupModal({ visible, onDismiss, onSuccess }: TwitchSetupModalProps) {
  const { sendAndWaitForResponse } = useWebSocketContext();
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const handleSave = async () => {
    if (!(clientId.trim() && clientSecret.trim())) {
      setErrorMessage('Please enter both Client ID and Client Secret');
      return;
    }

    setIsLoading(true);
    setErrorMessage('');

    try {
      const payload: IntegrationConfigurePayload = {
        integrationName: 'twitch-auth',
        config: {
          clientId: clientId.trim(),
          clientSecret: clientSecret.trim(),
          redirectUri: 'http://localhost:8080/callback/twitch',
        },
      };

      await sendAndWaitForResponse(createMessage(MessageType.INTEGRATION_CONFIGURE, payload));

      // Success! Close and trigger OAuth flow
      onSuccess();
      handleClose();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to save credentials');
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    setClientId('');
    setClientSecret('');
    setErrorMessage('');
    setIsLoading(false);
    onDismiss();
  };

  return (
    <Modal
      visible={visible}
      onDismiss={handleClose}
      header="Twitch Application Setup"
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={handleClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleSave}
              loading={isLoading}
              disabled={!(clientId.trim() && clientSecret.trim())}
            >
              Save & Continue
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="m">
        <Alert type="info">
          <Box variant="p">
            <strong>First Time Setup</strong>
            <br />
            You need to register a Twitch application to use Twitch integration. This is free and
            takes about 2 minutes.
          </Box>
        </Alert>

        <Box variant="p">
          <strong>Step 1:</strong> Register your application on Twitch
        </Box>

        <Box>
          1. Go to{' '}
          <Link external href="https://dev.twitch.tv/console/apps">
            dev.twitch.tv/console/apps
          </Link>
          <br />
          2. Click <strong>"Register Your Application"</strong>
          <br />
          3. Fill in:
          <ul>
            <li>
              <strong>Name:</strong> TuringMod Local (or any name you prefer)
            </li>
            <li>
              <strong>OAuth Redirect URLs:</strong>{' '}
              <code>http://localhost:8080/callback/twitch</code>
            </li>
            <li>
              <strong>Category:</strong> Application Integration
            </li>
          </ul>
          4. Click <strong>"Create"</strong>
          <br />
          5. Copy your <strong>Client ID</strong>
          <br />
          6. Click <strong>"New Secret"</strong> and copy the <strong>Client Secret</strong>
        </Box>

        <Box variant="p">
          <strong>Step 2:</strong> Enter your credentials below
        </Box>

        <FormField label="Client ID" description="Copy from your Twitch application page">
          <Input
            value={clientId}
            onChange={(e) => setClientId(e.detail.value)}
            placeholder="Enter Client ID"
          />
        </FormField>

        <FormField label="Client Secret" description="Click 'New Secret' on Twitch to generate">
          <Input
            value={clientSecret}
            onChange={(e) => setClientSecret(e.detail.value)}
            type="password"
            placeholder="Enter Client Secret"
          />
        </FormField>

        {errorMessage && (
          <Alert type="error" header="Configuration Error">
            {errorMessage}
          </Alert>
        )}

        <Alert type="info">
          <Box variant="p">
            <strong>Security Note:</strong> Your credentials are encrypted using AES-256-GCM and
            stored locally on your machine. They are never sent to any external servers except
            Twitch's official API.
          </Box>
        </Alert>
      </SpaceBetween>
    </Modal>
  );
}
