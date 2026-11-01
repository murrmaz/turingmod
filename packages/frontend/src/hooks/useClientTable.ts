import {
  type ColumnDef,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
} from '@tanstack/react-table';
import { DEFAULT_PAGE_SIZE } from '@/constants/paging';

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
 * server: the Commands and Suggestions pages. The table instance keeps its own sort, column
 * filters, selection and page, which a page reads and changes through `table`. `pagination` goes
 * straight to DataTablePagination.
 */
export function useClientTable<Row>({
  data,
  columns,
  getRowId,
  initialSort,
  matches,
}: ClientTableOptions<Row>) {
  const table = useReactTable({
    data,
    columns,
    getRowId,
    globalFilterFn: (row, _id, value: string) => matches(row.original, value.trim().toLowerCase()),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: {
      sorting: initialSort,
      globalFilter: '',
      pagination: { pageSize: DEFAULT_PAGE_SIZE, pageIndex: 0 },
    },
  });
  const { globalFilter, pagination } = table.getState();

  return {
    table,
    filter: String(globalFilter),
    setFilter: table.setGlobalFilter,
    /** How many rows match the filters, on any page. */
    shown: table.getFilteredRowModel().rows.length,
    pagination: {
      page: pagination.pageIndex,
      pageCount: table.getPageCount(),
      onPageChange: table.setPageIndex,
    },
  };
}
