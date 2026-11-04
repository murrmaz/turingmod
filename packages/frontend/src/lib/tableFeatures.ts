import {
  columnFilteringFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  createFilteredRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  filterFn_includesString,
  globalFilteringFeature,
  rowPaginationFeature,
  rowSelectionFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  sortFn_datetime,
  sortFn_text,
  tableFeatures,
} from '@tanstack/react-table';

/**
 * What every table in the console can do. TanStack Table v9 only offers the features a table
 * registers, and the row-model slots here (sorted, filtered, paginated) process rows in the
 * console. A table whose rows are sorted, filtered or paged by the backend therefore sets
 * `manualSorting`, `manualFiltering` and `manualPagination` for the stages it leaves to it.
 */
export const consoleFeatures = tableFeatures({
  rowSortingFeature,
  columnSizingFeature,
  columnFilteringFeature,
  globalFilteringFeature,
  rowPaginationFeature,
  rowSelectionFeature,
  columnVisibilityFeature,
  sortedRowModel: createSortedRowModel(),
  filteredRowModel: createFilteredRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  sortFns: {
    alphanumeric: sortFn_alphanumeric,
    basic: sortFn_basic,
    datetime: sortFn_datetime,
    text: sortFn_text,
  },
  filterFns: { includesString: filterFn_includesString },
});

export type ConsoleFeatures = typeof consoleFeatures;

/** A table whose rows the backend has already sorted, filtered and cut to one page. */
export const PAGED_BY_SERVER = {
  manualSorting: true,
  manualFiltering: true,
  manualPagination: true,
} as const;
