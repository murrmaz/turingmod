import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Modal from '@cloudscape-design/components/modal';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Spinner from '@cloudscape-design/components/spinner';
import {
  MessageType,
  type OAuthAuthUrlResponsePayload,
  type OAuthCodeReceivedPayload,
  type OAuthExchangeResultPayload,
  createOAuthExchangeCodeMessage,
  createOAuthGetAuthUrlMessage,
} from '@turingmod/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useWebSocketContext } from '../../context/WebSocketContext';

export interface TwitchOAuthModalProps {
  /** Whether the modal is visible */
  visible: boolean;
  /** Callback when modal is dismissed */
  onDismiss: () => void;
  /** Callback when OAuth is successful */
  onSuccess: () => void;
  /** Callback when credentials are not configured */
  onNeedsSetup?: () => void;
}

/**
 * Twitch OAuth Authorization Modal
 * Opens popup window for OAuth, automatically captures code and exchanges it
 */
export function TwitchOAuthModal({
  visible,
  onDismiss,
  onSuccess,
  onNeedsSetup,
}: TwitchOAuthModalProps) {
  const { sendAndWaitForResponse, subscribe } = useWebSocketContext();
  const [step, setStep] = useState<'loading' | 'waiting' | 'exchanging' | 'error'>('loading');
  const [authUrl, setAuthUrl] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const popupRef = useRef<Window | null>(null);
  const popupCheckIntervalRef = useRef<number | null>(null);

  // Close popup window
  const closePopup = useCallback(() => {
    if (popupRef.current && !popupRef.current.closed) {
      popupRef.current.close();
    }
    if (popupCheckIntervalRef.current) {
      clearInterval(popupCheckIntervalRef.current);
      popupCheckIntervalRef.current = null;
    }
  }, []);

  // Handle modal close
  const handleClose = useCallback(() => {
    closePopup();
    setStep('loading');
    setAuthUrl('');
    setErrorMessage('');
    onDismiss();
  }, [closePopup, onDismiss]);

  // Open auth popup
  const openAuthPopup = useCallback((url: string) => {
    const width = 600;
    const height = 800;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;

    popupRef.current = window.open(
      url,
      'TwitchAuth',
      `width=${width},height=${height},left=${left},top=${top},toolbar=no,location=no,status=no,menubar=no`
    );

    // Check if popup was blocked
    if (!popupRef.current) {
      setErrorMessage('Popup was blocked. Please allow popups for this site.');
      setStep('error');
      return;
    }

    // Monitor popup close
    popupCheckIntervalRef.current = window.setInterval(() => {
      if (popupRef.current?.closed) {
        if (popupCheckIntervalRef.current !== null) {
          clearInterval(popupCheckIntervalRef.current);
        }
        popupCheckIntervalRef.current = null;
        // User closed popup without completing auth
        setErrorMessage('Authorization cancelled');
        setStep('error');
      }
    }, 500);
  }, []);

  // Exchange the authorization code for tokens
  const exchangeCode = useCallback(
    async (code: string) => {
      setStep('exchanging');
      setErrorMessage('');

      try {
        const response = await sendAndWaitForResponse<OAuthExchangeResultPayload>(
          createOAuthExchangeCodeMessage('twitch-auth', code)
        );

        if (response.payload.success) {
          // Success! Integration should start automatically
          closePopup();
          onSuccess();
          handleClose();
        } else {
          setErrorMessage(response.payload.errorMessage || 'Failed to exchange code');
          setStep('error');
          closePopup();
        }
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : 'Unknown error');
        setStep('error');
        closePopup();
      }
    },
    [sendAndWaitForResponse, closePopup, onSuccess, handleClose]
  );

  // Fetch the authorization URL when modal opens
  const fetchAuthUrl = useCallback(async () => {
    setStep('loading');
    setErrorMessage('');

    try {
      const response = await sendAndWaitForResponse<OAuthAuthUrlResponsePayload>(
        createOAuthGetAuthUrlMessage('twitch-auth')
      );

      if (response.payload.authUrl) {
        setAuthUrl(response.payload.authUrl);
        // Open popup with auth URL
        openAuthPopup(response.payload.authUrl);
        setStep('waiting');
      } else {
        setErrorMessage('Failed to get authorization URL');
        setStep('error');
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';

      // Check if error is due to missing credentials
      if (errorMsg.includes('not configured') || errorMsg.includes('Client ID')) {
        // Credentials not configured - show setup modal instead
        if (onNeedsSetup) {
          onNeedsSetup();
          handleClose();
          return;
        }
      }

      setErrorMessage(errorMsg);
      setStep('error');
    }
  }, [sendAndWaitForResponse, openAuthPopup, onNeedsSetup, handleClose]);

  // Subscribe to OAuth code received events
  useEffect(() => {
    const unsubscribe = subscribe((message) => {
      if (message.type === MessageType.OAUTH_CODE_RECEIVED) {
        const payload = message.payload as OAuthCodeReceivedPayload;
        if (payload.integrationName === 'twitch-auth') {
          // Automatically exchange the code
          exchangeCode(payload.code);
        }
      }
    });

    return () => {
      unsubscribe();
    };
  }, [subscribe, exchangeCode]);

  // Fetch auth URL when modal becomes visible
  useEffect(() => {
    if (visible && step === 'loading' && !authUrl) {
      fetchAuthUrl();
    }
  }, [visible, step, authUrl, fetchAuthUrl]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      closePopup();
    };
  }, [closePopup]);

  return (
    <Modal
      visible={visible}
      onDismiss={handleClose}
      header="Authorize Twitch"
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={handleClose}>
              Cancel
            </Button>
            {step === 'error' && (
              <Button variant="primary" onClick={fetchAuthUrl}>
                Try Again
              </Button>
            )}
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="m">
        {step === 'loading' && (
          <Box textAlign="center">
            <SpaceBetween size="m">
              <Spinner size="large" />
              <Box variant="p">Loading authorization URL...</Box>
            </SpaceBetween>
          </Box>
        )}

        {step === 'waiting' && (
          <>
            <Alert type="info">
              <Box variant="p">
                <strong>Waiting for Authorization</strong>
                <br />A popup window has opened for you to authorize TuringMod on Twitch.
              </Box>
            </Alert>

            <Box textAlign="center">
              <SpaceBetween size="m">
                <Spinner size="large" />
                <Box variant="p">
                  Please complete the authorization in the popup window.
                  <br />
                  The code will be captured automatically.
                </Box>
              </SpaceBetween>
            </Box>

            <Box variant="p" fontSize="body-s" color="text-body-secondary">
              <strong>Popup blocked?</strong> If the popup didn't open, please allow popups for this
              site and try again.
            </Box>
          </>
        )}

        {step === 'exchanging' && (
          <Box textAlign="center">
            <SpaceBetween size="m">
              <Spinner size="large" />
              <Box variant="p">Exchanging authorization code for access tokens...</Box>
            </SpaceBetween>
          </Box>
        )}

        {step === 'error' && errorMessage && (
          <>
            <Alert type="error" header="Authorization Failed">
              {errorMessage}
            </Alert>

            <Box variant="p">
              Please try again. If the problem persists, check the backend logs for more details.
            </Box>
          </>
        )}

        <Alert type="warning">
          <Box variant="p">
            <strong>Security Note:</strong> TuringMod only runs locally on your computer (
            <code>localhost</code>). Your tokens are encrypted and stored securely in a local
            database. They are never sent to any external servers except Twitch's official API.
          </Box>
        </Alert>
      </SpaceBetween>
    </Modal>
  );
}
