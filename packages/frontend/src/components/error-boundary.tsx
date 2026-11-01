import { toError } from '@turingmod/shared';
import { CircleAlert } from 'lucide-react';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * A page's code failing to load: each browser words it differently. It happens when the console
 * was rebuilt while this tab stayed open, so the page it asks for no longer exists.
 */
const STALE_BUILD =
  /dynamically imported module|Importing a module script failed|Unable to preload CSS/i;

interface ErrorBoundaryProps {
  children: ReactNode;
  className?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Shows what went wrong, with a way out, in place of whatever below it threw while rendering.
 * Without one, React unmounts the whole console to a blank page. Remount it (a new `key`) to try
 * again, e.g. on navigating to another page.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error: toError(error) };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('[ErrorBoundary] Render failed', error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) {
      return this.props.children;
    }
    const stale = STALE_BUILD.test(error.message);
    return (
      <div
        role="alert"
        className={cn('flex flex-1 items-center justify-center p-8', this.props.className)}
      >
        <div className="flex max-w-md flex-col gap-3">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <CircleAlert className="size-5 text-status-error" />
            {stale ? 'TuringMod has been updated' : 'Something went wrong on this page'}
          </h2>
          <p className="text-sm text-soft-foreground">
            {stale
              ? 'This tab is still running the previous version. Reload to get the new one.'
              : 'Reloading usually fixes it. If it keeps happening, the browser console has the details.'}
          </p>
          {!stale && (
            <pre className="overflow-x-auto rounded-lg border bg-muted/40 p-3 font-mono text-xs text-muted-foreground">
              {error.message}
            </pre>
          )}
          <div>
            <Button size="sm" onClick={() => window.location.reload()}>
              Reload
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
