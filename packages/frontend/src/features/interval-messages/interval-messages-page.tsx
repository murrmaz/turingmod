import type { ColumnDef } from '@tanstack/react-table';
import { ANNOUNCEMENT_INTERVAL_MS } from '@turingmod/shared';
import { ArrowDown, ArrowUp, CirclePause, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { actionsColumn, RowActionsMenu } from '@/components/data-table/actions-column';
import { DataTable } from '@/components/data-table/data-table';
import { DataTablePagination } from '@/components/data-table/pagination';
import { LoadFailure } from '@/components/load-failure';
import { PageHeader } from '@/components/page-header';
import { PageLayout } from '@/components/page-layout';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { useClientTable } from '@/hooks/useClientTable';
import { plural } from '@/lib/plural';
import type { ConsoleFeatures } from '@/lib/tableFeatures';
import { formatDateTime } from '@/lib/time';
import { IntervalMessageDialog } from './interval-message-dialog';
import { type IntervalMessage, useIntervalMessages } from './useIntervalMessages';

const INTERVAL_MINUTES = ANNOUNCEMENT_INTERVAL_MS / 60_000;

export function IntervalMessagesPage() {
  const { messages, nextId, status, add, update, setEnabled, move, remove } = useIntervalMessages();
  /** What the dialog is open on, if it is: a message being edited, or a new one. */
  const [dialog, setDialog] = useState<IntervalMessage | 'new' | null>(null);

  const columns = useMemo<ColumnDef<ConsoleFeatures, IntervalMessage>[]>(
    () => [
      {
        id: 'order',
        header: 'Order',
        size: 84,
        cell: ({ row, table }) => (
          <div className="flex gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground"
              aria-label="Move up"
              title="Move up"
              disabled={row.index === 0}
              onClick={(event) => {
                event.stopPropagation();
                move(row.original.id, 'up');
              }}
            >
              <ArrowUp />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground"
              aria-label="Move down"
              title="Move down"
              disabled={row.index === table.options.data.length - 1}
              onClick={(event) => {
                event.stopPropagation();
                move(row.original.id, 'down');
              }}
            >
              <ArrowDown />
            </Button>
          </div>
        ),
      },
      {
        id: 'message',
        header: 'Message',
        meta: { grow: true, cellClassName: 'whitespace-normal break-words py-2' },
        cell: ({ row }) => (
          <span className="flex flex-wrap items-center gap-2">
            {row.original.message}
            {row.original.id === nextId && <Badge variant="secondary">Next</Badge>}
          </span>
        ),
      },
      {
        id: 'enabled',
        header: 'Active',
        size: 70,
        cell: ({ row }) => (
          <Checkbox
            aria-label={row.original.enabled ? 'Pause message' : 'Resume message'}
            checked={row.original.enabled}
            onCheckedChange={(checked) => setEnabled(row.original.id, checked === true)}
            onClick={(event) => event.stopPropagation()}
          />
        ),
      },
      {
        id: 'lastPostedAt',
        header: 'Last posted',
        size: 180,
        cell: ({ row }) => (
          <span className="font-mono text-data text-muted-foreground">
            {row.original.lastPostedAt === null
              ? 'Never'
              : formatDateTime(row.original.lastPostedAt)}
          </span>
        ),
      },
      actionsColumn(({ row }) => (
        <RowActionsMenu label="Message actions">
          <DropdownMenuItem onSelect={() => setDialog(row.original)}>Edit…</DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={() => remove([row.original.id])}>
            Delete
          </DropdownMenuItem>
        </RowActionsMenu>
      )),
    ],
    [nextId, move, setEnabled, remove]
  );

  // Always in rotation order: nothing sorts it, and a filter would make moving a row ambiguous.
  const { table, pagination } = useClientTable({
    data: messages,
    columns,
    getRowId: (message) => String(message.id),
    initialSort: [],
  });

  return (
    <PageLayout>
      <PageHeader
        title="Interval Messages"
        description={`Posted to chat one at a time, every ${INTERVAL_MINUTES} minutes while you're live, in this order.`}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => setDialog('new')}>
          <Plus />
          Add message
        </Button>
      </div>
      <LoadFailure status={status} />
      {messages.length > 0 && nextId === null && (
        <Alert>
          <CirclePause />
          <AlertDescription>Every message is paused, so nothing will be posted.</AlertDescription>
        </Alert>
      )}
      <DataTable
        framed
        table={table}
        rowHeight={45}
        loading={status.state !== 'live'}
        onRowClick={setDialog}
        rowClassName={(message) => (message.enabled ? undefined : 'opacity-60')}
        empty="No interval messages yet. Add one and it will be posted to chat while you're live."
      />
      <DataTablePagination {...pagination} summary={plural(messages.length, 'message')} />
      {dialog !== null && (
        <IntervalMessageDialog
          {...(dialog === 'new' ? {} : { initialText: dialog.message })}
          onSave={async (message) => {
            await (dialog === 'new' ? add(message) : update(dialog.id, message));
            setDialog(null);
          }}
          onDismiss={() => setDialog(null)}
        />
      )}
    </PageLayout>
  );
}
