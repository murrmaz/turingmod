import {
  ARDUINO_DEFAULT_URL,
  ArduinoConfigSchema,
  IntegrationName,
  MessageType,
  messageOf,
} from '@turingmod/shared';
import { CircleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
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
import type { ConfigSetupModalProps } from './DiscordSetupModal';

/**
 * Arduino setup: the address of the board's WebSocket server. It opens on the address in use, and
 * saving always sends one, so saving without changing anything keeps it.
 */
export function ArduinoSetupModal({
  integration,
  visible,
  onDismiss,
  onSuccess,
}: ConfigSetupModalProps) {
  const { request } = useWebSocketContext();
  const currentUrl = integration.address ?? ARDUINO_DEFAULT_URL;
  const [url, setUrl] = useState(currentUrl);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // Each time it opens, start from the address in use rather than whatever was typed last time.
  useEffect(() => {
    if (visible) {
      setUrl(currentUrl);
    }
  }, [visible, currentUrl]);

  const parsed = ArduinoConfigSchema.safeParse({ url: url.trim() });
  const urlValid = parsed.success;

  const handleClose = () => {
    setErrorMessage('');
    setIsLoading(false);
    onDismiss();
  };

  const handleSave = async () => {
    if (!parsed.success) {
      return;
    }
    setIsLoading(true);
    setErrorMessage('');
    try {
      await request(MessageType.INTEGRATION_CONFIGURE, {
        integrationName: IntegrationName.ARDUINO,
        config: parsed.data,
      });
      onSuccess();
      handleClose();
    } catch (error) {
      setErrorMessage(messageOf(error, 'Failed to save the Arduino settings'));
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={visible} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Arduino setup</DialogTitle>
          <DialogDescription>
            TuringMod connects to a Wi-Fi board (such as an ESP32) running TuringMod firmware, which
            serves a WebSocket on your network.
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex flex-col gap-5 text-sm"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSave();
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="arduino-url">Board address</Label>
            <Input
              id="arduino-url"
              className="font-mono"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              aria-invalid={url.trim() !== '' && !urlValid}
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">
              The reference firmware announces itself as {ARDUINO_DEFAULT_URL}. If your network
              doesn't resolve <span className="font-mono">.local</span> names, use the board's IP
              address and reserve it in your router so it doesn't change.
            </p>
          </div>

          {errorMessage && (
            <Alert variant="destructive">
              <CircleAlert />
              <AlertTitle>Configuration error</AlertTitle>
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={handleClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!urlValid || isLoading}>
              {isLoading ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
