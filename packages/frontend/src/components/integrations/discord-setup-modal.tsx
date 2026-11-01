import { DiscordConfigSchema, DiscordSnowflakeSchema, IntegrationName } from '@turingmod/shared';
import { ExternalLink, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { FormField } from '@/components/form-field';
import { Input } from '@/components/ui/input';
import { type ConfigSetupModalProps, IntegrationConfigDialog } from './integration-config-dialog';

/**
 * Discord setup: the bot's token and the channel go-live notifications are posted in. Saving
 * replaces the whole config, so both are asked for every time.
 */
export function DiscordSetupModal({ onDismiss, onSaved }: ConfigSetupModalProps) {
  const [botToken, setBotToken] = useState('');
  const [channelId, setChannelId] = useState('');

  const channelIdValid = DiscordSnowflakeSchema.safeParse(channelId.trim()).success;
  const parsed = DiscordConfigSchema.safeParse({
    botToken,
    notificationChannelId: channelId.trim(),
  });

  return (
    <IntegrationConfigDialog
      integrationName={IntegrationName.DISCORD}
      title="Discord setup"
      description="TuringMod posts go-live notifications through a Discord bot of your own. Creating one is free and takes a few minutes."
      config={parsed.success ? parsed.data : null}
      failureMessage="Failed to save the Discord settings"
      footnote={
        <p className="flex gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="size-4 shrink-0" />
          The token is encrypted with AES-256-GCM and stored on this computer, and only ever sent to
          Discord's official API.
        </p>
      }
      onDismiss={onDismiss}
      onSaved={onSaved}
      className="sm:max-w-xl"
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
            On the <strong>Bot</strong> page, click <strong>Reset Token</strong> and copy the token.
            No privileged intents are needed.
          </li>
          <li>
            On the <strong>OAuth2</strong> page's URL Generator, tick the <strong>bot</strong> scope
            and the permissions <strong>View Channels</strong>, <strong>Send Messages</strong>,{' '}
            <strong>Embed Links</strong> and <strong>Mention Everyone</strong>, then open the
            generated URL and add the bot to the server
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
        <FormField label="Bot token">
          {(field) => (
            <Input
              {...field}
              className="font-mono"
              type="password"
              value={botToken}
              onChange={(event) => setBotToken(event.target.value)}
              autoComplete="off"
            />
          )}
        </FormField>
        <FormField
          label="Channel ID"
          hint={
            <>
              A long number, such as 123456789012345678. Every go-live post pings @everyone in this
              channel.
            </>
          }
        >
          {(field) => (
            <Input
              {...field}
              className="font-mono"
              inputMode="numeric"
              value={channelId}
              onChange={(event) => setChannelId(event.target.value)}
              aria-invalid={channelId.trim() !== '' && !channelIdValid}
              autoComplete="off"
            />
          )}
        </FormField>
      </section>
    </IntegrationConfigDialog>
  );
}
