import { type DataRowsPage, type DataRowsQuery, MAX_DATA_PAGE_SIZE } from '@turingmod/shared';
import { useServerQuery } from './useServerQuery';

/** The page sizes a paged data view offers, up to the most the backend returns in one page. */
export const DATA_PAGE_SIZES = [25, 50, 100, MAX_DATA_PAGE_SIZE];

const NO_ROWS: DataRowsPage = { rows: [], total: 0 };

/**
 * One page of a table, read through the backend's read-only data inspector, again whenever the
 * query changes. A failed read shows no rows, with the error for the view to show in their place.
 */
export function useDataRows(query: DataRowsQuery) {
  const { data, loading, error } = useServerQuery(
    (trpc, input, opts) => trpc.data.queryRows.query(input, opts),
    { input: query, initial: NO_ROWS }
  );
  return { ...(error === null ? data : NO_ROWS), loading, error };
}
