import {
  CHAT_MESSAGE_LIMITS,
  IntervalMessageTextSchema,
  messageOf,
  platformDisplayName,
  StreamingPlatform,
} from '@turingmod/shared';
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
import { Textarea } from '@/components/ui/textarea';

const MAX_LENGTH = CHAT_MESSAGE_LIMITS[StreamingPlatform.TWITCH];
const SHORTEST_PLATFORM = StreamingPlatform.YOUTUBE;
const SHORTEST_LIMIT = CHAT_MESSAGE_LIMITS[SHORTEST_PLATFORM];

/** The length so far, and what's wrong with the text or will happen to it. */
function hintFor(text: string, problem: string | undefined): string {
  const length = Array.from(text.trim()).length;
  const count = `${length} / ${MAX_LENGTH}`;
  if (problem !== undefined && text.trim() !== '') {
    return `${count}. ${problem}.`;
  }
  return length > SHORTEST_LIMIT
    ? `${count}. ${platformDisplayName(SHORTEST_PLATFORM)} cuts messages off at ${SHORTEST_LIMIT} characters.`
    : count;
}

/**
 * Adding an interval message, or editing one when given its text. Render it only while it's open,
 * so each opening starts fresh. A failed save stays open with the error, so nothing typed is lost.
 */
export function IntervalMessageDialog({
  initialText,
  onSave,
  onDismiss,
}: {
  /** The text being edited; leave it out to add a new message. */
  initialText?: string;
  /** Saves the text, rejecting if that fails. The dialog stays open until the caller closes it. */
  onSave: (message: string) => Promise<void>;
  onDismiss: () => void;
}) {
  const [text, setText] = useState(initialText ?? '');
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const parsed = IntervalMessageTextSchema.safeParse(text);
  const editing = initialText !== undefined;

  const save = async () => {
    if (!parsed.success || saving) {
      return;
    }
    setSaving(true);
    setErrorMessage('');
    try {
      await onSave(parsed.data);
    } catch (error) {
      setErrorMessage(messageOf(error, "Couldn't save the message"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onDismiss()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit message' : 'Add message'}</DialogTitle>
          <DialogDescription>
            {editing ? 'It keeps its place in the rotation.' : 'It joins the end of the rotation.'}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-5 text-sm"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <FormField label="Message" hint={hintFor(text, parsed.error?.issues[0]?.message)}>
            {(field) => (
              <Textarea
                {...field}
                value={text}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => {
                  // A chat message is one line, so Enter saves, as it does in chat.
                  if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
                aria-invalid={text.trim() !== '' && !parsed.success}
                autoComplete="off"
              />
            )}
          </FormField>

          {errorMessage && (
            <Alert variant="destructive">
              <CircleAlert />
              <AlertTitle>Couldn't save the message</AlertTitle>
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
