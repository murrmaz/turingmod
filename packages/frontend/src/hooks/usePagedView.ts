import { useState } from 'react';
import { DATA_PAGE_SIZES, DEFAULT_PAGE_SIZE } from '@/constants/paging';
import { useStateFor } from './useStateFor';

/**
 * Where the streamer is in a table paged by the server: its page and page size, and the row
 * selected. A new `view` (what's being read, compared by value, whichever way it changed) or page
 * size goes back to the first page, and any change of page leaves nothing selected, since a row
 * selected there isn't on the page shown.
 *
 * A `view` shouldn't hold a time that moves on by itself, or it counts as a new one: give the name
 * of a date range, not its start.
 */
export function usePagedView(view: unknown) {
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [page, setPage] = useStateFor([view, pageSize], 0);
  const [selected, select] = useStateFor<string | null>([view, pageSize, page], null);

  return {
    page,
    goTo: setPage,
    pageSize,
    selected,
    select,
    /** Props for DataTablePagination, once the read has said how many rows there are. */
    pagination: (total: number) => ({
      page,
      pageCount: Math.ceil(total / pageSize),
      onPageChange: setPage,
      pageSize,
      pageSizes: DATA_PAGE_SIZES,
      onPageSizeChange: setPageSize,
    }),
  };
}
