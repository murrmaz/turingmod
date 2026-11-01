import {
  type ColumnDef,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type RowSelectionState,
  type SortingState,
  useReactTable,
} from '@tanstack/react-table';
import { Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { DataTableColumnHeader } from '@/components/data-table/column-header';
import { DataTable } from '@/components/data-table/data-table';
import { DataTablePagination } from '@/components/data-table/pagination';
import { PageHeader } from '@/components/page-header';
import { PageLayout } from '@/components/page-layout';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { type Suggestion, useSuggestions } from '@/hooks/useSuggestions';
import { formatDateTime } from '@/lib/time';

const PAGE_SIZE = 50;

export function SuggestionsPage() {
  const { suggestions, remove } = useSuggestions();
  const [sorting, setSorting] = useState<SortingState>([{ id: 'createdAt', desc: true }]);
  const [globalFilter, setGlobalFilter] = useState('');
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});

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

  const table = useReactTable({
    data: suggestions,
    columns,
    state: { sorting, globalFilter, rowSelection },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onRowSelectionChange: setRowSelection,
    globalFilterFn: (row, _id, value: string) => {
      const needle = value.trim().toLowerCase();
      return (
        row.original.suggestion.toLowerCase().includes(needle) ||
        (row.original.suggestedBy ?? '').toLowerCase().includes(needle)
      );
    },
    getRowId: (row) => String(row.id),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: PAGE_SIZE, pageIndex: 0 } },
  });

  // Only rows still listed and matching the filter: a selection never deletes what isn't shown.
  const selected = table.getFilteredSelectedRowModel().rows.map((row) => row.original.id);
  const deleteSelected = () => {
    remove(selected);
    setRowSelection({});
  };

  const shown = table.getFilteredRowModel().rows.length;
  const { pageIndex } = table.getState().pagination;

  return (
    <PageLayout>
      <PageHeader
        title="Suggestions"
        description="Suggestions viewers have made in chat with !sg."
      />
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={globalFilter}
          onChange={(event) => setGlobalFilter(event.target.value)}
          placeholder="Filter by text or viewer…"
          className="w-72"
        />
        {selected.length > 0 && (
          <>
            <Button variant="destructive" size="sm" onClick={deleteSelected}>
              <Trash2 />
              Delete {selected.length} selected
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setRowSelection({})}>
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
            rowSelection[String(suggestion.id)] ? 'bg-muted hover:bg-muted' : undefined
          }
          empty={
            suggestions.length === 0
              ? 'No suggestions yet. Viewers can add one with !sg.'
              : 'No suggestions match.'
          }
        />
      </div>
      <DataTablePagination
        page={pageIndex}
        pageCount={table.getPageCount()}
        onPageChange={(page) => table.setPageIndex(page)}
        summary={`${shown} of ${suggestions.length} suggestions`}
      />
    </PageLayout>
  );
}
