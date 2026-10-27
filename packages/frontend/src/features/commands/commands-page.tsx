import {
  type ColumnDef,
  type ColumnFiltersState,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
} from '@tanstack/react-table';
import {
  formatPlatformList,
  PERMISSION_HIERARCHY,
  PermissionLevel,
  platformDisplayName,
  StreamingPlatform,
} from '@turingmod/shared';
import { Ellipsis } from 'lucide-react';
import { useMemo, useState } from 'react';
import { DataTableColumnHeader } from '@/components/data-table/column-header';
import { DataTable } from '@/components/data-table/data-table';
import { DataTableFacetedFilter } from '@/components/data-table/faceted-filter';
import { DataTablePagination } from '@/components/data-table/pagination';
import { DataTableViewOptions } from '@/components/data-table/view-options';
import { DotBadge, type Tone } from '@/components/status';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';

import { type CommandInfo, useAppState } from '@/context/AppStateContext';
import { copyToClipboard } from '@/lib/reportError';
import { PERMISSION_LABELS, useSimulator } from './simulator';

const PERMISSION_TONES: Record<PermissionLevel, Tone> = {
  [PermissionLevel.VIEWER]: 'idle',
  [PermissionLevel.SUBSCRIBER]: 'viewer',
  [PermissionLevel.VIP]: 'viewer',
  [PermissionLevel.MODERATOR]: 'command',
  [PermissionLevel.BROADCASTER]: 'error',
};

/** The least privileged level that may run a command: what "who can use this" means. */
function lowestPermission(command: CommandInfo): PermissionLevel {
  return (
    PERMISSION_HIERARCHY.find((level) => command.permissions.includes(level)) ??
    PermissionLevel.BROADCASTER
  );
}

const PAGE_SIZE = 50;

export function CommandsPage() {
  const { commands } = useAppState();
  const simulator = useSimulator();
  const [sorting, setSorting] = useState<SortingState>([{ id: 'name', desc: false }]);
  const [globalFilter, setGlobalFilter] = useState('');
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);

  const columns = useMemo<ColumnDef<CommandInfo>[]>(
    () => [
      {
        id: 'name',
        accessorKey: 'name',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Command" />,
        size: 160,
        enableHiding: false,
        cell: ({ row }) => (
          <span className="font-mono text-[13.5px] font-medium">!{row.original.name}</span>
        ),
      },
      {
        id: 'description',
        accessorKey: 'description',
        header: 'Description',
        meta: { grow: true },
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-soft-foreground" title={row.original.usage}>
            {row.original.description}
          </span>
        ),
      },
      {
        id: 'permission',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Permission" />,
        accessorFn: (command) => PERMISSION_HIERARCHY.indexOf(lowestPermission(command)),
        size: 150,
        filterFn: (row, _id, value: string[]) => value.includes(lowestPermission(row.original)),
        cell: ({ row }) => {
          const level = lowestPermission(row.original);
          return <DotBadge tone={PERMISSION_TONES[level]}>{PERMISSION_LABELS[level]}</DotBadge>;
        },
      },
      {
        id: 'cooldown',
        accessorKey: 'cooldown',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Cooldown" />,
        size: 110,
        cell: ({ row }) => (
          <span className="font-mono text-[12.5px] text-muted-foreground">
            {row.original.cooldown > 0 ? `${row.original.cooldown}s` : '—'}
          </span>
        ),
      },
      {
        id: 'platforms',
        header: 'Platforms',
        accessorFn: (command) => command.availableOn.join(' '),
        size: 150,
        enableSorting: false,
        filterFn: (row, _id, value: string[]) =>
          value.every((platform) => row.original.availableOn.some((p) => p === platform)),
        cell: ({ row }) => (
          <span className="text-[12.5px] text-muted-foreground">
            {formatPlatformList(row.original.availableOn) || '—'}
          </span>
        ),
      },
      {
        id: 'actions',
        size: 52,
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
                aria-label="Command actions"
                onClick={(event) => event.stopPropagation()}
              >
                <Ellipsis />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}>
              <DropdownMenuItem onSelect={() => simulator.open({ command: row.original.name })}>
                Simulate…
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void copyToClipboard(row.original.usage, 'usage')}>
                Copy usage
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    [simulator]
  );

  const table = useReactTable({
    data: commands,
    columns,
    state: { sorting, globalFilter, columnFilters },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onColumnFiltersChange: setColumnFilters,
    globalFilterFn: (row, _id, value: string) => {
      const needle = value.trim().toLowerCase().replace(/^!/, '');
      return (
        row.original.name.includes(needle) ||
        row.original.description.toLowerCase().includes(needle)
      );
    },
    getRowId: (row) => row.name,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: PAGE_SIZE, pageIndex: 0 } },
  });

  const facet = (id: string) => {
    const value = table.getColumn(id)?.getFilterValue();
    return new Set(Array.isArray(value) ? value.map(String) : []);
  };
  const setFacet = (id: string) => (next: Set<string>) =>
    table.getColumn(id)?.setFilterValue(next.size > 0 ? [...next] : undefined);

  const shown = table.getFilteredRowModel().rows.length;
  const { pageIndex } = table.getState().pagination;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 px-8 py-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Commands</h2>
        <p className="text-sm text-muted-foreground">
          Every chat command, its permission level and where it works.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={globalFilter}
          onChange={(event) => setGlobalFilter(event.target.value)}
          placeholder="Filter commands…"
          className="w-72"
        />
        <DataTableFacetedFilter
          title="Permission"
          options={PERMISSION_HIERARCHY.map((level) => ({
            value: level,
            label: PERMISSION_LABELS[level],
          }))}
          selected={facet('permission')}
          onChange={setFacet('permission')}
        />
        <DataTableFacetedFilter
          title="Platform"
          options={Object.values(StreamingPlatform).map((platform) => ({
            value: platform,
            label: platformDisplayName(platform),
          }))}
          selected={facet('platforms')}
          onChange={setFacet('platforms')}
        />
        <DataTableViewOptions table={table} />
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border">
        <DataTable
          table={table}
          rowHeight={45}
          onRowClick={(command) => simulator.open({ command: command.name })}
          empty={commands.length === 0 ? 'No commands loaded yet.' : 'No commands match.'}
        />
      </div>
      <DataTablePagination
        page={pageIndex}
        pageCount={table.getPageCount()}
        onPageChange={(page) => table.setPageIndex(page)}
        summary={`${shown} of ${commands.length} commands`}
      />
    </div>
  );
}
