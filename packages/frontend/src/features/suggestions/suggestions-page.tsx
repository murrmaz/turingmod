import type { ColumnDef } from '@tanstack/react-table';
import { Trash2 } from 'lucide-react';
import { useMemo } from 'react';
import { DataTableColumnHeader } from '@/components/data-table/column-header';
import { DataTable } from '@/components/data-table/data-table';
import { DataTablePagination } from '@/components/data-table/pagination';
import { PageHeader } from '@/components/page-header';
import { PageLayout } from '@/components/page-layout';
import { SearchInput } from '@/components/search-input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { useClientTable } from '@/hooks/useClientTable';
import { plural } from '@/lib/plural';
import { formatDateTime } from '@/lib/time';
import { type Suggestion, useSuggestions } from './useSuggestions';

export function SuggestionsPage() {
  const { suggestions, remove } = useSuggestions();

  const columns = useMemo<ColumnDef<Suggestion>[]>(
    () => [
      {
        id: 'select',
        size: 44,
        enableSorting: false,
        enableHiding: false,
        header: ({ table }) => (
          <Checkbox
            aria-label="Select all on this page"
            checked={
              table.getIsAllPageRowsSelected()
                ? true
                : table.getIsSomePageRowsSelected()
                  ? 'indeterminate'
                  : false
            }
            onCheckedChange={(checked) => table.toggleAllPageRowsSelected(checked === true)}
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            aria-label="Select suggestion"
            checked={row.getIsSelected()}
            onCheckedChange={(checked) => row.toggleSelected(checked === true)}
            onClick={(event) => event.stopPropagation()}
          />
        ),
      },
      {
        id: 'suggestion',
        accessorKey: 'suggestion',
        header: 'Suggestion',
        meta: { grow: true, cellClassName: 'whitespace-normal break-words py-2' },
        enableSorting: false,
      },
      {
        id: 'suggestedBy',
        accessorFn: (suggestion) => suggestion.suggestedBy ?? '',
        header: ({ column }) => <DataTableColumnHeader column={column} title="From" />,
        size: 170,
        cell: ({ row }) => (
          <span className="text-soft-foreground">{row.original.suggestedBy ?? '—'}</span>
        ),
      },
      {
        id: 'createdAt',
        accessorKey: 'createdAt',
        header: ({ column }) => <DataTableColumnHeader column={column} title="When" />,
        size: 180,
        cell: ({ row }) => (
          <span className="font-mono text-data text-muted-foreground">
            {formatDateTime(row.original.createdAt)}
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
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground hover:text-destructive"
            aria-label="Delete suggestion"
            title="Delete"
            onClick={(event) => {
              event.stopPropagation();
              remove([row.original.id]);
            }}
          >
            <Trash2 />
          </Button>
        ),
      },
    ],
    [remove]
  );

  const { table, filter, setFilter, shown, pagination } = useClientTable({
    data: suggestions,
    columns,
    getRowId: (suggestion) => String(suggestion.id),
    initialSort: [{ id: 'createdAt', desc: true }],
    matches: (suggestion, needle) =>
      suggestion.suggestion.toLowerCase().includes(needle) ||
      (suggestion.suggestedBy ?? '').toLowerCase().includes(needle),
  });

  // Only rows still listed and matching the filter: a selection never deletes what isn't shown.
  const selected = table.getFilteredSelectedRowModel().rows.map((row) => row.original.id);
  const deleteSelected = () => {
    remove(selected);
    table.setRowSelection({});
  };

  return (
    <PageLayout>
      <PageHeader
        title="Suggestions"
        description="Suggestions viewers have made in chat with !sg."
      />
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter by text or viewer…"
          className="w-72"
        />
        {selected.length > 0 && (
          <>
            <Button variant="destructive" size="sm" onClick={deleteSelected}>
              <Trash2 />
              Delete {selected.length} selected
            </Button>
            <Button variant="ghost" size="sm" onClick={() => table.setRowSelection({})}>
              Clear selection
            </Button>
          </>
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border">
        <DataTable
          table={table}
          rowHeight={45}
          onRowClick={(suggestion) => table.getRow(String(suggestion.id)).toggleSelected()}
          rowClassName={(suggestion) =>
            table.getState().rowSelection[String(suggestion.id)]
              ? 'bg-muted hover:bg-muted'
              : undefined
          }
          empty={
            suggestions.length === 0
              ? 'No suggestions yet. Viewers can add one with !sg.'
              : 'No suggestions match.'
          }
        />
      </div>
      <DataTablePagination
        {...pagination}
        summary={`${shown} of ${plural(suggestions.length, 'suggestion')}`}
      />
    </PageLayout>
  );
}
