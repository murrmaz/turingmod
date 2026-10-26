import { CircleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useConnection } from '@/hooks/useConnection';

/**
 * Across the top of every page while the console has lost the backend: it retries by itself, but
 * nothing below updates until it's back, and on a second monitor a quiet indicator goes unseen.
 */
export function ConnectionBanner() {
  const { connectionState, retry } = useConnection();
  if (connectionState !== 'reconnecting') {
    return null;
  }
  return (
    <div
      role="alert"
      className="flex shrink-0 items-center gap-3 border-b border-cat-error/40 bg-cat-error/10 px-4 py-2 text-sm"
    >
      <CircleAlert className="size-4 shrink-0 text-cat-error" />
      <p className="min-w-0 flex-1">
        <span className="font-medium">Lost connection to TuringMod.</span>{' '}
        <span className="text-soft-foreground">
          Reconnecting… Everything below is as it was when the connection dropped.
        </span>
      </p>
      <Button size="sm" variant="outline" onClick={retry}>
        Retry now
      </Button>
    </div>
  );
}
