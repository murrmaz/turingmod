import { toast } from 'sonner';
import { reportActionError } from './reportError';

/** Copy text for the streamer, confirming it, since a copy is otherwise invisible. */
export async function copyToClipboard(text: string, what: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`Copied ${what}`);
  } catch (error) {
    reportActionError(`Couldn't copy ${what}`, error);
  }
}
