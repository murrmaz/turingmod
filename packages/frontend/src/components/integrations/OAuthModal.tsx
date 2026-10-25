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
import { useWebSocketContext } from '@/context/WebSocketContext';
import { useWebSocketMessage } from '@/hooks/useWebSocket';
import type { OAuthProviderConfig } from './oauthProviders';

export interface OAuthModalProps {
  /** The integration this modal is authorizing */
  provider: OAuthProviderConfig;
  onDismiss: () => void;
  /** The code was exchanged for tokens. */
  onSuccess: () => void;
}

type Step = 'loading' | 'waiting' | 'error';

/** Open the sign-in page in a popup centred over the console; null when the browser blocks it. */
function openPopup(url: string, name: string): Window | null {
  const width = 600;
  const height = 800;
  const left = window.screenX + (window.outerWidth - width) / 2;
  const top = window.screenY + (window.outerHeight - height) / 2;
  return window.open(
    url,
    name,
    `width=${width},height=${height},left=${left},top=${top},toolbar=no,location=no,status=no,menubar=no`
  );
}

/**
 * Authorizes an OAuth integration. Render it only while authorizing: opening starts an attempt,
 * and closing ends it, popup included.
 *
 * An attempt asks the backend for the provider's authorization URL and opens it in a popup. The
 * provider redirects to the backend's own callback (whose URI the backend derives), where the
 * backend exchanges the code itself and broadcasts how it went (`oauth.result`); this only waits
 * for that. The flow doesn't depend on this dialog: closing it, or the console, mid sign-in still
 * connects the integration.
 */
export function OAuthModal({ provider, onDismiss, onSuccess }: OAuthModalProps) {
  const { request } = useWebSocketContext();
  const [step, setStep] = useState<Step>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  /** Bumped by Try again, which starts a new attempt. */
  const [attempt, setAttempt] = useState(0);
  const popupRef = useRef<Window | null>(null);
  const { integrationName, popupWindowName } = provider;

  const fail = useCallback((message: string) => {
    setErrorMessage(message);
    setStep('error');
  }, []);

  const closePopup = useCallback(() => {
    const popup = popupRef.current;
    popupRef.current = null;
    if (popup && !popup.closed) {
      popup.close();
    }
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt starts a new attempt on Try again
  useEffect(() => {
    let cancelled = false;
    let watcher: number | undefined;
    setStep('loading');
    setErrorMessage('');

    request(MessageType.OAUTH_GET_AUTH_URL, { integrationName })
      .then(({ authUrl }) => {
        if (cancelled) {
          return;
        }
        if (!authUrl) {
          fail('Failed to get authorization URL');
          return;
        }
        const popup = openPopup(authUrl, popupWindowName);
        if (!popup) {
          fail('Popup was blocked. Please allow popups for this site.');
          return;
        }
        popupRef.current = popup;
        setStep('waiting');
        // The popup closing before the result (which clears popupRef first) means the streamer
        // closed it without finishing. The backend announces the result before its page closes
        // the popup, so a finished sign-in isn't mistaken for this.
        watcher = window.setInterval(() => {
          if (popup.closed) {
            window.clearInterval(watcher);
            if (popupRef.current === popup) {
              popupRef.current = null;
              fail('Authorization cancelled');
            }
          }
        }, 500);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          fail(messageOf(error));
        }
      });

    return () => {
      cancelled = true;
      window.clearInterval(watcher);
      closePopup();
    };
  }, [request, integrationName, popupWindowName, fail, closePopup, attempt]);

  useWebSocketMessage(
    MessageType.OAUTH_RESULT,
    useCallback(
      (result) => {
        if (result.integrationName !== integrationName) {
          return;
        }
        closePopup();
        if (result.success) {
          onSuccess();
        } else {
          fail(result.errorMessage || 'Authorization failed');
        }
      },
      [integrationName, closePopup, onSuccess, fail]
    )
  );

  return (
    <Dialog open onOpenChange={(open) => !open && onDismiss()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Authorize {provider.displayName}</DialogTitle>
          <DialogDescription>
            Sign in to {provider.displayName} in the window that opens; TuringMod connects by itself
            once you have.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 text-sm">
          {step === 'loading' && (
            <div className="flex items-center justify-center gap-3 py-6 text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
              Loading authorization URL…
            </div>
          )}

          {step === 'waiting' && (
            <>
              <Alert>
                <Info />
                <AlertTitle>Waiting for authorization</AlertTitle>
                <AlertDescription>
                  Complete the authorization in the popup window. TuringMod connects as soon as
                  you've signed in.
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
          <Button variant="ghost" onClick={onDismiss}>
            Cancel
          </Button>
          {step === 'error' && <Button onClick={() => setAttempt((n) => n + 1)}>Try again</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
