import { Copy } from 'lucide-react';
import { useEffect } from 'react';
import { DotBadge } from '@/components/status';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { type FeedRow, formatDateTime, PLATFORM_LABELS } from '@/constants/activityFormat';

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') {
    return '—';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

/**
 * Everything about one activity entry. ↑/↓ step through the rows the table is showing while it's
 * open.
 */
export function EventSheet({
  row,
  onClose,
  onStep,
  onViewUser,
}: {
  row: FeedRow | null;
  onClose: () => void;
  onStep: (direction: -1 | 1) => void;
  onViewUser: (user: string) => void;
}) {
  useEffect(() => {
    if (!row) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        onStep(event.key === 'ArrowDown' ? 1 : -1);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [row, onStep]);

  const fields = row ? Object.entries(row.entry.data) : [];

  return (
    <Sheet open={row !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-[420px] gap-5 p-6 sm:max-w-[420px]">
        {row && (
          <>
            <SheetHeader className="gap-2 p-0 pr-6">
              <div className="flex items-center gap-2">
                <DotBadge tone={row.tone}>{row.label}</DotBadge>
                <span className="font-mono text-xs text-muted-foreground">{row.entry.event}</span>
              </div>
              <SheetTitle className="text-lg leading-snug break-words">{row.title}</SheetTitle>
              <SheetDescription>
                {[
                  row.user,
                  row.platform ? PLATFORM_LABELS[row.platform] : null,
                  formatDateTime(row.timestamp),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </SheetDescription>
            </SheetHeader>

            {row.detail && <p className="text-sm text-soft-foreground">{row.detail}</p>}

            <dl className="flex min-h-0 flex-col overflow-y-auto text-[13.5px]">
              {fields.map(([key, value]) => (
                <div key={key} className="flex gap-4 border-b py-2.5 last:border-b-0">
                  <dt className="shrink-0 text-muted-foreground">{key}</dt>
                  <dd className="ml-auto min-w-0 text-right font-mono text-[12.5px] break-all">
                    {formatValue(value)}
                  </dd>
                </div>
              ))}
            </dl>

            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium text-muted-foreground">Actions</span>
              <Button
                variant="outline"
                onClick={() =>
                  void navigator.clipboard.writeText(JSON.stringify(row.entry, null, 2))
                }
              >
                <Copy />
                Copy JSON
              </Button>
              {row.user && (
                <Button variant="ghost" onClick={() => onViewUser(row.user)}>
                  View {row.user}’s history
                </Button>
              )}
            </div>

            <SheetFooter className="p-0 text-xs text-subtle-foreground">
              Esc to close · ↑↓ to step through events
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
