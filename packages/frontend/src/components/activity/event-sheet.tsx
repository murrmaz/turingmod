import { platformDisplayName } from '@turingmod/shared';
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
import type { FeedRow } from '@/lib/activityFormat';
import { copyToClipboard } from '@/lib/clipboard';
import { formatDateTime } from '@/lib/time';

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
 * Everything about the selected activity entry, open while one is selected. ↑/↓ select the row
 * above or below it among `rows`, the rows the table is showing in the order it shows them.
 */
export function EventSheet({
  rows,
  selectedId,
  onSelect,
  onViewUser,
}: {
  rows: readonly FeedRow[];
  selectedId: string | null;
  /** Select another row, or none (closing the sheet). */
  onSelect: (id: string | null) => void;
  onViewUser: (user: string) => void;
}) {
  const index = rows.findIndex((candidate) => candidate.id === selectedId);
  const row = rows[index] ?? null;
  const above = rows[index - 1]?.id;
  const below = rows[index + 1]?.id;

  useEffect(() => {
    if (selectedId === null) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const next = event.key === 'ArrowDown' ? below : above;
        if (next !== undefined) {
          onSelect(next);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedId, above, below, onSelect]);

  const fields = row ? Object.entries(row.entry.data) : [];

  return (
    <Sheet open={row !== null} onOpenChange={(open) => !open && onSelect(null)}>
      <SheetContent className="w-sheet gap-5 p-6 sm:max-w-sheet">
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
                  row.platform ? platformDisplayName(row.platform) : null,
                  formatDateTime(row.timestamp),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </SheetDescription>
            </SheetHeader>

            {row.detail && <p className="text-sm text-soft-foreground">{row.detail}</p>}

            <dl className="flex min-h-0 flex-col overflow-y-auto text-body">
              {fields.map(([key, value]) => (
                <div key={key} className="flex gap-4 border-b py-2.5 last:border-b-0">
                  <dt className="shrink-0 text-muted-foreground">{key}</dt>
                  <dd className="ml-auto min-w-0 text-right font-mono text-data break-all">
                    {formatValue(value)}
                  </dd>
                </div>
              ))}
            </dl>

            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium text-muted-foreground">Actions</span>
              <Button
                variant="outline"
                onClick={() => void copyToClipboard(JSON.stringify(row.entry, null, 2), 'JSON')}
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
