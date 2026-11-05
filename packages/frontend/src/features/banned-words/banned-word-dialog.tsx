import { BannedWordSchema, defaultWholeWord, messageOf } from '@turingmod/shared';
import { CircleAlert } from 'lucide-react';
import { useId, useState } from 'react';
import { FormField } from '@/components/form-field';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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

/** What's wrong with the text, or what will be saved if that isn't what was typed. */
function hintFor(text: string, word: string | undefined): string {
  if (text.trim() === '' || word === text.trim()) {
    return 'A single word. Chat is matched whatever its case or punctuation, and through spellings like sp1d3r.';
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
  initial,
  onSave,
  onDismiss,
}: {
  /** The word being edited; leave it out to ban a new one. */
  initial?: { word: string; wholeWord: boolean };
  /** Saves the word, rejecting if that fails. The dialog stays open until the caller closes it. */
  onSave: (word: string, wholeWord: boolean) => Promise<void>;
  onDismiss: () => void;
}) {
  const [text, setText] = useState(initial?.word ?? '');
  /** Null until it's chosen: a new word's checkbox follows its length until then. */
  const [wholeWordChoice, setWholeWordChoice] = useState(initial?.wholeWord ?? null);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const parsed = BannedWordSchema.safeParse(text);
  const editing = initial !== undefined;
  const wholeWord = wholeWordChoice ?? defaultWholeWord(parsed.data ?? '');
  const wholeWordId = useId();
  const wholeWordHintId = `${wholeWordId}-hint`;

  const save = async () => {
    if (!parsed.success || saving) {
      return;
    }
    setSaving(true);
    setErrorMessage('');
    try {
      await onSave(parsed.data, wholeWord);
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

          <div className="grid gap-2">
            <div className="flex items-center gap-2">
              <Checkbox
                id={wholeWordId}
                aria-describedby={wholeWordHintId}
                checked={wholeWord}
                onCheckedChange={(checked) => setWholeWordChoice(checked === true)}
              />
              <Label htmlFor={wholeWordId}>Whole word only</Label>
            </div>
            <p id={wholeWordHintId} className="text-xs text-muted-foreground">
              {wholeWord
                ? 'Banning hell catches h3ll, but not hello.'
                : 'Also catches it inside longer words: banning spider catches spiderman.'}
            </p>
          </div>

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
