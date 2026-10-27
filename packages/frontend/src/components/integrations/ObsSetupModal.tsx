import { IntegrationName, OBS_DEFAULT_URL, ObsConfigSchema } from '@turingmod/shared';
import { ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ConfigSetupModalProps } from './DiscordSetupModal';
import { IntegrationConfigDialog } from './IntegrationConfigDialog';

/**
 * OBS setup: obs-websocket's address and password. It opens on the address in use; the password
 * never comes back from the backend, and saving replaces the whole config, so it is asked for
 * every time and an empty one means authentication is off.
 */
export function ObsSetupModal({ integration, onDismiss, onSaved }: ConfigSetupModalProps) {
  const [url, setUrl] = useState(() => integration.address ?? OBS_DEFAULT_URL);
  const [password, setPassword] = useState('');
  const parsed = ObsConfigSchema.safeParse({
    url: url.trim(),
    ...(password === '' ? {} : { password }),
  });

  return (
    <IntegrationConfigDialog
      integrationName={IntegrationName.OBS}
      title="OBS setup"
      description="TuringMod controls OBS through its built-in WebSocket server. In OBS, open Tools → WebSocket Server Settings, enable it, and copy the details from Show Connect Info."
      config={parsed.success ? parsed.data : null}
      failureMessage="Failed to save the OBS settings"
      footnote={
        <p className="flex gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="size-4 shrink-0" />
          The password is encrypted and stored on this computer, and only ever sent to OBS.
        </p>
      }
      onDismiss={onDismiss}
      onSaved={onSaved}
      className="sm:max-w-lg"
    >
      <div className="grid gap-2">
        <Label htmlFor="obs-url">Server address</Label>
        <Input
          id="obs-url"
          className="font-mono"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          aria-invalid={url.trim() !== '' && !parsed.success}
          autoComplete="off"
        />
        <p className="text-xs text-muted-foreground">
          {OBS_DEFAULT_URL} when OBS runs on this computer with its default port.
        </p>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="obs-password">Server password</Label>
        <Input
          id="obs-password"
          className="font-mono"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="off"
        />
        <p className="text-xs text-muted-foreground">
          Leave empty only if authentication is off in OBS. Saving replaces the stored password, so
          enter it again whenever you save.
        </p>
      </div>
    </IntegrationConfigDialog>
  );
}
