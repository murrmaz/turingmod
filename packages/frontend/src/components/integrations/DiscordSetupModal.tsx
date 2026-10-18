import {
  createMessage,
  DiscordSnowflakeSchema,
  type IntegrationConfigurePayload,
  MessageType,
  messageOf,
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
import { useWebSocketContext } from '../../context/WebSocketContext';

export interface ConfigSetupModalProps {
  visible: boolean;
  onDismiss: () => void;
  /** The config was saved (and, if the integration was running, it restarted on it). */
  onSuccess: () => void;
}

/**
 * Discord setup: the bot's token and the channel go-live notifications are posted in. Saving
 * replaces the whole config, so both are asked for every time.
 */
export function DiscordSetupModal({ visible, onDismiss, onSuccess }: ConfigSetupModalProps) {
  const { sendAndWaitForResponse } = useWebSocketContext();
  const [botToken, setBotToken] = useState('');
  const [channelId, setChannelId] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const channelIdValid = DiscordSnowflakeSchema.safeParse(channelId.trim()).success;
  const ready = Boolean(botToken.trim()) && channelIdValid;

  const handleClose = () => {
    setBotToken('');
    setChannelId('');
    setErrorMessage('');
    setIsLoading(false);
    onDismiss();
  };

  const handleSave = async () => {
    if (!ready) {
      return;
    }
    setIsLoading(true);
    setErrorMessage('');
    try {
      const payload: IntegrationConfigurePayload = {
        integrationName: 'discord',
        config: { botToken: botToken.trim(), notificationChannelId: channelId.trim() },
      };
      await sendAndWaitForResponse(createMessage(MessageType.INTEGRATION_CONFIGURE, payload));
      onSuccess();
      handleClose();
    } catch (error) {
      setErrorMessage(messageOf(error, 'Failed to save the Discord settings'));
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={visible} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Discord setup</DialogTitle>
          <DialogDescription>
            TuringMod posts go-live notifications through a Discord bot of your own. Creating one is
            free and takes a few minutes.
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
            <h3 className="font-medium">1. Create the bot</h3>
            <ol className="ml-5 list-decimal space-y-1.5 text-muted-foreground marker:text-subtle-foreground [&_strong]:text-foreground">
              <li>
                Go to{' '}
                <a
                  href="https://discord.com/developers/applications"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-foreground underline underline-offset-4"
                >
                  discord.com/developers/applications
                  <ExternalLink className="size-3" />
                </a>{' '}
                and click <strong>New Application</strong> (name it TuringMod, or anything)
              </li>
              <li>
                On the <strong>Bot</strong> page, click <strong>Reset Token</strong> and copy the
                token. No privileged intents are needed.
              </li>
              <li>
                On the <strong>OAuth2</strong> page's URL Generator, tick the <strong>bot</strong>{' '}
                scope and the permissions <strong>View Channels</strong>,{' '}
                <strong>Send Messages</strong>, <strong>Embed Links</strong> and{' '}
                <strong>Mention Everyone</strong>, then open the generated URL and add the bot to
                the server
              </li>
            </ol>
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="font-medium">2. Find the channel</h3>
            <ol className="ml-5 list-decimal space-y-1.5 text-muted-foreground marker:text-subtle-foreground [&_strong]:text-foreground">
              <li>
                In Discord, turn on <strong>Developer Mode</strong> (User Settings → Advanced)
              </li>
              <li>
                Right-click the notifications channel and click <strong>Copy Channel ID</strong>
              </li>
            </ol>
          </section>

          <section className="flex flex-col gap-3">
            <h3 className="font-medium">3. Enter them</h3>
            <div className="grid gap-2">
              <Label htmlFor="discord-bot-token">Bot token</Label>
              <Input
                id="discord-bot-token"
                className="font-mono"
                type="password"
                value={botToken}
                onChange={(event) => setBotToken(event.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="discord-channel-id">Channel ID</Label>
              <Input
                id="discord-channel-id"
                className="font-mono"
                inputMode="numeric"
                value={channelId}
                onChange={(event) => setChannelId(event.target.value)}
                aria-invalid={channelId.trim() !== '' && !channelIdValid}
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">
                A long number, such as 123456789012345678. Every go-live post pings @everyone in
                this channel.
              </p>
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
            The token is encrypted with AES-256-GCM and stored on this computer, and only ever sent
            to Discord's official API.
          </p>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={handleClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!ready || isLoading}>
              {isLoading ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
