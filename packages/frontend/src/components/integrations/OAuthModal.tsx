import { MessageType, messageOf } from '@turingmod/shared';
import { CircleAlert, Info, Loader2, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useWebSocketContext } from '../../context/WebSocketContext';
import { useWebSocketMessage } from '../../hooks/useWebSocket';
import type { OAuthProviderConfig } from './oauthProviders';

export interface OAuthModalProps {
  /** Whether the modal is visible */
  visible: boolean;
  /** Callback when modal is dismissed */
  onDismiss: () => void;
  /** Callback when OAuth is successful */
  onSuccess: () => void;
  /** The integration this modal is authorizing */
  provider: OAuthProviderConfig;
}

/**
 * OAuth Authorization Modal
 * Opens popup window for OAuth, automatically captures code and exchanges it
 */
export function OAuthModal({ visible, onDismiss, onSuccess, provider }: OAuthModalProps) {
  const { request } = useWebSocketContext();
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
  const openAuthPopup = useCallback(
    (url: string) => {
      const width = 600;
      const height = 800;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;

      popupRef.current = window.open(
        url,
        provider.popupWindowName,
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
    },
    [provider.popupWindowName]
  );

  // Exchange the authorization code for tokens
  const exchangeCode = useCallback(
    async (code: string) => {
      setStep('exchanging');
      setErrorMessage('');

      try {
        const result = await request(MessageType.OAUTH_EXCHANGE_CODE, {
          integrationName: provider.integrationName,
          code,
        });

        if (result.success) {
          // Success! Integration should start automatically
          closePopup();
          onSuccess();
          handleClose();
        } else {
          setErrorMessage(result.errorMessage || 'Failed to exchange code');
          setStep('error');
          closePopup();
        }
      } catch (error) {
        setErrorMessage(messageOf(error));
        setStep('error');
        closePopup();
      }
    },
    [request, closePopup, onSuccess, handleClose, provider.integrationName]
  );

  // Fetch the authorization URL when modal opens
  const fetchAuthUrl = useCallback(async () => {
    setStep('loading');
    setErrorMessage('');

    try {
      const { authUrl } = await request(MessageType.OAUTH_GET_AUTH_URL, {
        integrationName: provider.integrationName,
      });

      if (authUrl) {
        setAuthUrl(authUrl);
        // Open popup with auth URL
        openAuthPopup(authUrl);
        setStep('waiting');
      } else {
        setErrorMessage('Failed to get authorization URL');
        setStep('error');
      }
    } catch (error) {
      setErrorMessage(messageOf(error));
      setStep('error');
    }
  }, [request, openAuthPopup, provider.integrationName]);

  // Subscribe to OAuth code received events
  useWebSocketMessage(
    MessageType.OAUTH_CODE_RECEIVED,
    useCallback(
      (payload) => {
        if (payload.integrationName === provider.integrationName) {
          // The popup's job is done the moment we have the code — close it now
          // rather than waiting on the exchange, so it can't race the backend's
          // own (independent) window-close behavior.
          closePopup();
          exchangeCode(payload.code);
        }
      },
      [exchangeCode, closePopup, provider.integrationName]
    )
  );

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
    <Dialog open={visible} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Authorize {provider.displayName}</DialogTitle>
          <DialogDescription>
            Sign in to {provider.displayName} in the window that opens; TuringMod picks the code up
            by itself.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 text-sm">
          {(step === 'loading' || step === 'exchanging') && (
            <div className="flex items-center justify-center gap-3 py-6 text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
              {step === 'loading'
                ? 'Loading authorization URL…'
                : 'Exchanging authorization code for access tokens…'}
            </div>
          )}

          {step === 'waiting' && (
            <>
              <Alert>
                <Info />
                <AlertTitle>Waiting for authorization</AlertTitle>
                <AlertDescription>
                  Complete the authorization in the popup window. The code will be captured
                  automatically.
                </AlertDescription>
              </Alert>
              <div className="flex items-center justify-center py-2">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              </div>
              <p className="text-xs text-muted-foreground">
                <strong>Popup blocked?</strong> Allow popups for this site and try again.
              </p>
            </>
          )}

          {step === 'error' && errorMessage && (
            <Alert variant="destructive">
              <CircleAlert />
              <AlertTitle>Authorization failed</AlertTitle>
              <AlertDescription>
                <p>{errorMessage}</p>
                <p>If it keeps failing, the backend logs have the details.</p>
              </AlertDescription>
            </Alert>
          )}

          <p className="flex gap-2 text-xs text-muted-foreground">
            <ShieldCheck className="size-4 shrink-0" />
            TuringMod only runs on this computer. Your tokens are encrypted in the local database
            and only ever sent to {provider.displayName}'s official API.
          </p>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={handleClose}>
            Cancel
          </Button>
          {step === 'error' && <Button onClick={fetchAuthUrl}>Try again</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
