import { ARDUINO_DEFAULT_URL, ArduinoConfigSchema, IntegrationName } from '@turingmod/shared';
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { type ConfigSetupModalProps, IntegrationConfigDialog } from './integration-config-dialog';

/**
 * Arduino setup: the address of the board's WebSocket server. It opens on the address in use, and
 * saving always sends one, so saving without changing anything keeps it.
 */
export function ArduinoSetupModal({ integration, onDismiss, onSaved }: ConfigSetupModalProps) {
  const [url, setUrl] = useState(() => integration.address ?? ARDUINO_DEFAULT_URL);
  const parsed = ArduinoConfigSchema.safeParse({ url: url.trim() });

  return (
    <IntegrationConfigDialog
      integrationName={IntegrationName.ARDUINO}
      title="Arduino setup"
      description="TuringMod connects to a Wi-Fi board (such as an ESP32) running TuringMod firmware, which serves a WebSocket on your network."
      config={parsed.success ? parsed.data : null}
      failureMessage="Failed to save the Arduino settings"
      onDismiss={onDismiss}
      onSaved={onSaved}
      className="sm:max-w-lg"
    >
      <div className="grid gap-2">
        <Label htmlFor="arduino-url">Board address</Label>
        <Input
          id="arduino-url"
          className="font-mono"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          aria-invalid={url.trim() !== '' && !parsed.success}
          autoComplete="off"
        />
        <p className="text-xs text-muted-foreground">
          The reference firmware announces itself as {ARDUINO_DEFAULT_URL}. If your network doesn't
          resolve <span className="font-mono">.local</span> names, use the board's IP address and
          reserve it in your router so it doesn't change.
        </p>
      </div>
    </IntegrationConfigDialog>
  );
}
