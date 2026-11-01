import type { ColumnDef } from '@tanstack/react-table';
import {
  formatPlatformList,
  PERMISSION_HIERARCHY,
  PermissionLevel,
  platformDisplayName,
  StreamingPlatform,
} from '@turingmod/shared';
import { Ellipsis } from 'lucide-react';
import { useMemo } from 'react';
import { DataTableColumnHeader } from '@/components/data-table/column-header';
import { DataTable } from '@/components/data-table/data-table';
import { DataTableFacetedFilter } from '@/components/data-table/faceted-filter';
import { DataTablePagination } from '@/components/data-table/pagination';
import { DataTableViewOptions } from '@/components/data-table/view-options';
import { PageHeader } from '@/components/page-header';
import { PageLayout } from '@/components/page-layout';
import { SearchInput } from '@/components/search-input';
import { DotBadge } from '@/components/status';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { PERMISSION_LABELS } from '@/constants/permissions';

import { type CommandInfo, useCommandList } from '@/context/app-state-context';
import { useSimulator } from '@/context/simulatorContext';
import { useClientTable } from '@/hooks/useClientTable';
import { copyToClipboard } from '@/lib/clipboard';
import { plural } from '@/lib/plural';
import type { Tone } from '@/lib/tone';

/** Colours that tell the levels apart, the broadcaster's being the red of going live. */
const PERMISSION_TONES: Record<PermissionLevel, Tone> = {
  [PermissionLevel.VIEWER]: 'idle',
  [PermissionLevel.SUBSCRIBER]: 'viewer',
  [PermissionLevel.VIP]: 'viewer',
  [PermissionLevel.MODERATOR]: 'command',
  [PermissionLevel.BROADCASTER]: 'live',
};

/** The least privileged level that may run a command: what "who can use this" means. */
function lowestPermission(command: CommandInfo): PermissionLevel {
  return (
    PERMISSION_HIERARCHY.find((level) => command.permissions.includes(level)) ??
    PermissionLevel.BROADCASTER
  );
}

export function CommandsPage() {
  const commands = useCommandList();
  const simulator = useSimulator();

  const columns = useMemo<ColumnDef<CommandInfo>[]>(
    () => [
      {
        id: 'name',
        accessorKey: 'name',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Command" />,
        size: 160,
        enableHiding: false,
        cell: ({ row }) => (
          <span className="font-mono text-body font-medium">!{row.original.name}</span>
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
          <span className="font-mono text-data text-muted-foreground">
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
          <span className="text-data text-muted-foreground">
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

  const { table, filter, setFilter, shown, pagination } = useClientTable({
    data: commands,
    columns,
    getRowId: (command) => command.name,
    initialSort: [{ id: 'name', desc: false }],
    matches: (command, typed) => {
      const needle = typed.replace(/^!/, '');
      return command.name.includes(needle) || command.description.toLowerCase().includes(needle);
    },
  });

  const facet = (id: string) => {
    const value = table.getColumn(id)?.getFilterValue();
    return new Set(Array.isArray(value) ? value.map(String) : []);
  };
  const setFacet = (id: string) => (next: Set<string>) =>
    table.getColumn(id)?.setFilterValue(next.size > 0 ? [...next] : undefined);

  return (
    <PageLayout>
      <PageHeader
        title="Commands"
        description="Every chat command, its permission level and where it works."
      />
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
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
        {...pagination}
        summary={`${shown} of ${plural(commands.length, 'command')}`}
      />
    </PageLayout>
  );
}
