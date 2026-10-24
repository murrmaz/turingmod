import type { ColumnDef } from '@tanstack/react-table';
import { platformDisplayName } from '@turingmod/shared';
import { Ellipsis } from 'lucide-react';
import { DataTableColumnHeader } from '@/components/data-table/column-header';
import { DotBadge } from '@/components/status';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { type FeedRow, formatClock, formatDateTime } from '@/constants/activityFormat';

export interface ActivityRowActions {
  onInspect: (row: FeedRow) => void;
  onViewUser: (user: string) => void;
}

/**
 * Columns shared by the live feed and History. The time is only a clock: the tables' day dividers
 * (`dayDivider`) say which day it's on, and hovering shows the full date.
 */
export function activityColumns<T extends FeedRow>(actions: ActivityRowActions): ColumnDef<T>[] {
  return [
    {
      id: 'time',
      accessorKey: 'timestamp',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Time" />,
      size: 96,
      enableHiding: false,
      cell: ({ row }) => (
        <span
          className="font-mono text-[12.5px] text-muted-foreground tabular-nums"
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
        <span className="text-[13.5px] font-medium" title={row.original.title}>
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
        <span className="text-[12.5px] text-muted-foreground">
          {row.original.platform ? platformDisplayName(row.original.platform) : '—'}
        </span>
      ),
    },
    {
      id: 'actions',
      size: 48,
      enableSorting: false,
      enableHiding: false,
      meta: { cellClassName: 'overflow-visible px-2 text-right' },
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground"
              aria-label="Row actions"
              onClick={(event) => event.stopPropagation()}
            >
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}>
            <DropdownMenuItem onSelect={() => actions.onInspect(row.original)}>
              Inspect
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() =>
                void navigator.clipboard.writeText(JSON.stringify(row.original.entry, null, 2))
              }
            >
              Copy JSON
            </DropdownMenuItem>
            {row.original.user && (
              <DropdownMenuItem onSelect={() => actions.onViewUser(row.original.user)}>
                View {row.original.user}’s history
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];
}
