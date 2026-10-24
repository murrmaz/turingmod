import {
  MessageType,
  messageOf,
  type OAuthClientCredentials,
  OAuthClientCredentialsSchema,
} from '@turingmod/shared';
import { CircleAlert, ExternalLink, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAppState } from '../../context/AppStateContext';
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
  const { request } = useWebSocketContext();
  const { integrations } = useAppState();
  // Reported by the backend, which derives it from its own port; never sent back to it.
  const redirectUri =
    integrations.find((integration) => integration.name === provider.integrationName)?.oauth
      ?.redirectUri ?? 'unavailable until the backend is connected';
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const handleSave = async () => {
    const parsed = OAuthClientCredentialsSchema.safeParse({
      clientId: clientId.trim(),
      clientSecret: clientSecret.trim(),
    });
    if (!parsed.success) {
      setErrorMessage('Please enter both Client ID and Client Secret');
      return;
    }
    const config: OAuthClientCredentials = parsed.data;

    setIsLoading(true);
    setErrorMessage('');

    try {
      await request(MessageType.INTEGRATION_CONFIGURE, {
        integrationName: provider.integrationName,
        config,
      });

      // Success! Close and trigger OAuth flow
      onSuccess();
      handleClose();
    } catch (error) {
      setErrorMessage(messageOf(error, 'Failed to save credentials'));
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

  const ready = Boolean(clientId.trim() && clientSecret.trim());

  return (
    <Dialog open={visible} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{provider.displayName} application setup</DialogTitle>
          <DialogDescription>
            {provider.displayName} needs an application of your own to sign in with. Registering one
            is free and takes about two minutes.
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex flex-col gap-5 text-sm"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSave();
          }}
        >
          <section className="flex flex-col gap-2">
            <h3 className="font-medium">1. Register an application</h3>
            <ol className="ml-5 list-decimal space-y-1.5 text-muted-foreground marker:text-subtle-foreground">
              <li>
                Go to{' '}
                <a
                  href={provider.registrationUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-foreground underline underline-offset-4"
                >
                  {provider.registrationLinkText}
                  <ExternalLink className="size-3" />
                </a>
              </li>
              <li>
                Click <strong className="text-foreground">“{provider.createButtonLabel}”</strong>
              </li>
              <li>
                Fill in:
                <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md border bg-muted/40 p-3 [&_code]:font-mono [&_code]:text-foreground">
                  {provider.fields(redirectUri).map((field) => (
                    <div key={field.label} className="contents">
                      <dt className="text-subtle-foreground">{field.label}</dt>
                      <dd className="text-foreground">{field.value}</dd>
                    </div>
                  ))}
                </dl>
              </li>
              <li>
                Click <strong className="text-foreground">“{provider.saveButtonLabel}”</strong>
              </li>
              {provider.finalSteps.map((step) => (
                <li key={step.id} className="[&_strong]:text-foreground">
                  {step.content}
                </li>
              ))}
            </ol>
          </section>

          <section className="flex flex-col gap-3">
            <h3 className="font-medium">2. Enter its credentials</h3>
            <div className="grid gap-2">
              <Label htmlFor="setup-client-id">Client ID</Label>
              <Input
                id="setup-client-id"
                className="font-mono"
                value={clientId}
                onChange={(event) => setClientId(event.target.value)}
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">{provider.clientIdHint}</p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="setup-client-secret">Client Secret</Label>
              <Input
                id="setup-client-secret"
                className="font-mono"
                type="password"
                value={clientSecret}
                onChange={(event) => setClientSecret(event.target.value)}
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">{provider.clientSecretHint}</p>
            </div>
          </section>

          {errorMessage && (
            <Alert variant="destructive">
              <CircleAlert />
              <AlertTitle>Configuration error</AlertTitle>
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          )}

          <p className="flex gap-2 text-xs text-muted-foreground">
            <ShieldCheck className="size-4 shrink-0" />
            Credentials are encrypted with AES-256-GCM and stored on this computer, and only ever
            sent to {provider.displayName}'s official API.
          </p>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={handleClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!ready || isLoading}>
              {isLoading ? 'Saving…' : 'Save & continue'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
