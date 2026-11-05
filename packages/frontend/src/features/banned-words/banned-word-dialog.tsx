import { BannedWordSchema, messageOf } from '@turingmod/shared';
import { CircleAlert } from 'lucide-react';
import { useState } from 'react';
import { FormField } from '@/components/form-field';
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

/** What's wrong with the text, or what will be saved if that isn't what was typed. */
function hintFor(text: string, word: string | undefined): string {
  if (text.trim() === '' || word === text.trim()) {
    return 'A single word. Case and punctuation are ignored, as they are in chat.';
  }
  return word === undefined
    ? 'One word only.'
    : `Saved as ${word}: case and punctuation are ignored.`;
}

/**
 * Adding a banned word, or correcting one when given it. Render it only while it's open, so each
 * opening starts fresh. A failed save stays open with the error, so nothing typed is lost.
 */
export function BannedWordDialog({
  initialWord,
  onSave,
  onDismiss,
}: {
  /** The word being corrected; leave it out to ban a new one. */
  initialWord?: string;
  /** Saves the word, rejecting if that fails. The dialog stays open until the caller closes it. */
  onSave: (word: string) => Promise<void>;
  onDismiss: () => void;
}) {
  const [text, setText] = useState(initialWord ?? '');
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const parsed = BannedWordSchema.safeParse(text);
  const editing = initialWord !== undefined;

  const save = async () => {
    if (!parsed.success || saving) {
      return;
    }
    setSaving(true);
    setErrorMessage('');
    try {
      await onSave(parsed.data);
    } catch (error) {
      setErrorMessage(messageOf(error, "Couldn't save the word"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onDismiss()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit word' : 'Add word'}</DialogTitle>
          <DialogDescription>
            {editing
              ? 'It keeps who banned it and when, so its ban ends on the same day.'
              : 'It stays banned for a month.'}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-5 text-sm"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <FormField label="Word" hint={hintFor(text, parsed.data)}>
            {(field) => (
              <Input
                {...field}
                value={text}
                onChange={(event) => setText(event.target.value)}
                aria-invalid={text.trim() !== '' && !parsed.success}
                autoComplete="off"
              />
            )}
          </FormField>

          {errorMessage && (
            <Alert variant="destructive">
              <CircleAlert />
              <AlertTitle>Couldn't save the word</AlertTitle>
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onDismiss}>
              Cancel
            </Button>
            <Button type="submit" disabled={!parsed.success || saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
