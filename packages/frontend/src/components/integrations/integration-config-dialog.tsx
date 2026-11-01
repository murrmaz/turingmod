import { type IntegrationInfo, messageOf } from '@turingmod/shared';
import { CircleAlert } from 'lucide-react';
import { type ReactNode, useState } from 'react';
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
import { useIntegrations } from '@/hooks/useIntegrations';
import { cn } from '@/lib/utils';

/** What every non-OAuth setup dialog takes (see CONFIG_SETUP_REGISTRY). */
export interface ConfigSetupModalProps {
  /** The integration being set up, as the backend last reported it. */
  integration: IntegrationInfo;
  onDismiss: () => void;
  /** The config was saved (and, if the integration was running, it restarted on it). */
  onSaved: () => void;
}

export interface IntegrationConfigDialogProps {
  integrationName: string;
  title: string;
  description: ReactNode;
  /**
   * The config Save sends, already validated against the integration's schema; null while the
   * form isn't complete and valid, which keeps Save disabled.
   */
  config: Record<string, unknown> | null;
  saveLabel?: string;
  /** Shown when saving fails without a message of its own. */
  failureMessage: string;
  /** Below the form, e.g. how the config is stored. */
  footnote?: ReactNode;
  onDismiss: () => void;
  /** The config was saved. Closing (or moving on) is the caller's: the dialog stays until then. */
  onSaved: () => void;
  className?: string;
  /** The instructions and fields. */
  children: ReactNode;
}

/**
 * The frame every integration setup dialog shares: the form, saving the config, the error if that
 * fails, and Cancel/Save. Render it only while it's open, so each opening starts from a fresh form.
 */
export function IntegrationConfigDialog({
  integrationName,
  title,
  description,
  config,
  saveLabel = 'Save',
  failureMessage,
  footnote,
  onDismiss,
  onSaved,
  className,
  children,
}: IntegrationConfigDialogProps) {
  const { configureIntegration } = useIntegrations();
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const save = async () => {
    if (config === null) {
      return;
    }
    setSaving(true);
    setErrorMessage('');
    try {
      await configureIntegration(integrationName, config);
      onSaved();
    } catch (error) {
      setErrorMessage(messageOf(error, failureMessage));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onDismiss()}>
      <DialogContent className={cn('max-h-[90svh] overflow-y-auto', className)}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <form
          className="flex flex-col gap-5 text-sm"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          {children}

          {errorMessage && (
            <Alert variant="destructive">
              <CircleAlert />
              <AlertTitle>Configuration error</AlertTitle>
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          )}

          {footnote}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onDismiss}>
              Cancel
            </Button>
            <Button type="submit" disabled={config === null || saving}>
              {saving ? 'Saving…' : saveLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
