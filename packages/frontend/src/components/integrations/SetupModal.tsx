import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import FormField from '@cloudscape-design/components/form-field';
import Input from '@cloudscape-design/components/input';
import Link from '@cloudscape-design/components/link';
import Modal from '@cloudscape-design/components/modal';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { type IntegrationConfigurePayload, MessageType, createMessage } from '@turingmod/shared';
import { Fragment, useState } from 'react';
import { useWebSocketContext } from '../../context/WebSocketContext';
import type { OAuthProviderConfig } from './oauthProviders';

export interface SetupModalProps {
  visible: boolean;
  onDismiss: () => void;
  onSuccess: () => void;
  /** The integration this modal configures */
  provider: OAuthProviderConfig;
}

/**
 * OAuth Integration Setup Modal
 * Allows user to configure an OAuth-capable integration's Client ID and Client Secret
 */
export function SetupModal({ visible, onDismiss, onSuccess, provider }: SetupModalProps) {
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
        integrationName: provider.integrationName,
        config: {
          clientId: clientId.trim(),
          clientSecret: clientSecret.trim(),
          redirectUri: provider.redirectUri,
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
      header={`${provider.displayName} Application Setup`}
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
            You need to register a {provider.displayName} application to use {provider.displayName}{' '}
            integration. This is free and takes about 2 minutes.
          </Box>
        </Alert>

        <Box variant="p">
          <strong>Step 1:</strong> Register your application on {provider.displayName}
        </Box>

        <Box>
          1. Go to{' '}
          <Link external href={provider.registrationUrl}>
            {provider.registrationLinkText}
          </Link>
          <br />
          2. Click <strong>&quot;{provider.createButtonLabel}&quot;</strong>
          <br />
          3. Fill in:
          <ul>
            {provider.fields.map((field) => (
              <li key={field.label}>
                <strong>{field.label}:</strong> {field.value}
              </li>
            ))}
          </ul>
          4. Click <strong>&quot;{provider.saveButtonLabel}&quot;</strong>
          <br />
          {provider.finalSteps.map((step, index) => (
            <Fragment key={step.id}>
              {index + 5}. {step.content}
              <br />
            </Fragment>
          ))}
        </Box>

        <Box variant="p">
          <strong>Step 2:</strong> Enter your credentials below
        </Box>

        <FormField label="Client ID" description={provider.clientIdHint}>
          <Input
            value={clientId}
            onChange={(e) => setClientId(e.detail.value)}
            placeholder="Enter Client ID"
          />
        </FormField>

        <FormField label="Client Secret" description={provider.clientSecretHint}>
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
            stored locally on your machine. They are never sent to any external servers except{' '}
            {provider.displayName}'s official API.
          </Box>
        </Alert>
      </SpaceBetween>
    </Modal>
  );
}
