import {
  type ColumnDef,
  type ColumnFiltersState,
  functionalUpdate,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
} from '@tanstack/react-table';
import { useState } from 'react';
import { DEFAULT_PAGE_SIZE } from '@/constants/paging';
import { useStateFor } from './useStateFor';

export interface ClientTableOptions<Row> {
  data: Row[];
  columns: ColumnDef<Row>[];
  getRowId: (row: Row) => string;
  initialSort: SortingState;
  /** Whether a row matches the filter box; `needle` is what's typed, trimmed and lowercased. */
  matches: (row: Row, needle: string) => boolean;
}

/**
 * A table whose rows are all in the console, sorted, filtered and paged here rather than on the
 * server: the Commands and Suggestions pages. A page reads and changes the sort, column filters and
 * selection through `table`. `pagination` goes straight to DataTablePagination.
 *
 * Sorting or filtering differently goes back to the first page, but new rows don't: a list that
 * changes under the streamer (a viewer's `!sg`, their own delete) leaves them on the page they're
 * on, or the last one left. TanStack Table would go back to the first page for any new data.
 */
export function useClientTable<Row>({
  data,
  columns,
  getRowId,
  initialSort,
  matches,
}: ClientTableOptions<Row>) {
  const [sorting, setSorting] = useState(initialSort);
  const [filter, setFilter] = useState('');
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [pageIndex, setPageIndex] = useStateFor([sorting, filter, columnFilters], 0);
  const pagination = { pageIndex, pageSize: DEFAULT_PAGE_SIZE };

  const table = useReactTable({
    data,
    columns,
    getRowId,
    state: { sorting, globalFilter: filter, columnFilters, pagination },
    onSortingChange: setSorting,
    onGlobalFilterChange: setFilter,
    onColumnFiltersChange: setColumnFilters,
    onPaginationChange: (updater) => setPageIndex(functionalUpdate(updater, pagination).pageIndex),
    autoResetPageIndex: false,
    globalFilterFn: (row, _id, value: string) => matches(row.original, value.trim().toLowerCase()),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  const lastPage = Math.max(0, table.getPageCount() - 1);
  if (pageIndex > lastPage) {
    setPageIndex(lastPage);
  }

  return {
    table,
    filter,
    setFilter,
    /** How many rows match the filters, on any page. */
    shown: table.getFilteredRowModel().rows.length,
    pagination: {
      page: pageIndex,
      pageCount: table.getPageCount(),
      onPageChange: table.setPageIndex,
    },
  };
}
