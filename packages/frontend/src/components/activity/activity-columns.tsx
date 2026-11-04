import type { ColumnDef } from '@tanstack/react-table';
import { platformDisplayName } from '@turingmod/shared';
import { actionsColumn, RowActionsMenu } from '@/components/data-table/actions-column';
import { DataTableColumnHeader } from '@/components/data-table/column-header';
import { DotBadge } from '@/components/status';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import type { FeedRow } from '@/lib/activityFormat';
import { copyToClipboard } from '@/lib/clipboard';
import type { ConsoleFeatures } from '@/lib/tableFeatures';
import { formatClock, formatDateTime } from '@/lib/time';

export interface ActivityRowActions {
  onInspect: (row: FeedRow) => void;
  onViewUser: (user: string) => void;
}

/**
 * Columns shared by the live feed and History. The time is only a clock: the tables' day dividers
 * (`dayDivider`) say which day it's on, and hovering shows the full date.
 */
export function activityColumns<T extends FeedRow>(
  actions: ActivityRowActions
): ColumnDef<ConsoleFeatures, T>[] {
  return [
    {
      id: 'time',
      accessorKey: 'timestamp',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Time" />,
      size: 96,
      enableHiding: false,
      cell: ({ row }) => (
        <span
          className="font-mono text-data text-muted-foreground tabular-nums"
          title={formatDateTime(row.original.timestamp)}
        >
          {formatClock(row.original.timestamp)}
        </span>
      ),
    },
    {
      id: 'type',
      header: 'Type',
      size: 116,
      enableSorting: false,
      cell: ({ row }) => <DotBadge tone={row.original.tone}>{row.original.label}</DotBadge>,
    },
    {
      id: 'event',
      header: 'Event',
      size: 200,
      enableSorting: false,
      cell: ({ row }) => (
        <span className="text-body font-medium" title={row.original.title}>
          {row.original.title}
        </span>
      ),
    },
    {
      id: 'detail',
      header: 'Detail',
      meta: { grow: true },
      enableSorting: false,
      cell: ({ row }) => (
        <span className="text-muted-foreground" title={row.original.detail}>
          {row.original.detail}
        </span>
      ),
    },
    {
      id: 'user',
      header: 'User',
      size: 140,
      enableSorting: false,
      cell: ({ row }) => <span className="text-soft-foreground">{row.original.user}</span>,
    },
    {
      id: 'platform',
      header: 'Platform',
      size: 96,
      enableSorting: false,
      cell: ({ row }) => (
        <span className="text-data text-muted-foreground">
          {row.original.platform ? platformDisplayName(row.original.platform) : '—'}
        </span>
      ),
    },
    actionsColumn(({ row }) => (
      <RowActionsMenu label="Row actions">
        <DropdownMenuItem onSelect={() => actions.onInspect(row.original)}>
          Inspect
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => void copyToClipboard(JSON.stringify(row.original.entry, null, 2), 'JSON')}
        >
          Copy JSON
        </DropdownMenuItem>
        {row.original.user && (
          <DropdownMenuItem onSelect={() => actions.onViewUser(row.original.user)}>
            View {row.original.user}’s history
          </DropdownMenuItem>
        )}
      </RowActionsMenu>
    )),
  ];
}
