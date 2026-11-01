import { messageOf } from '@turingmod/shared';
import { toast } from 'sonner';
import { isConnectionError } from '@/services/connection';

/**
 * Something the streamer did failed: always say so, connection loss included, so a click is never
 * answered with nothing.
 */
export function reportActionError(title: string, error: unknown): void {
  console.error(`[console] ${title}`, error);
  toast.error(title, { description: messageOf(error) });
}

/**
 * Something the console reads by itself failed. Not when the connection is down: the banner
 * already says so, and everything is read again on reconnect. Toasted under its title as id, so
 * the same failure repeating replaces its toast rather than stacking another.
 */
export function reportLoadError(title: string, error: unknown): void {
  console.error(`[console] ${title}`, error);
  if (isConnectionError(error)) {
    return;
  }
  toast.error(title, { id: title, description: messageOf(error) });
}
