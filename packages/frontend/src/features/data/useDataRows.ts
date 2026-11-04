import type { RouterInputs, RouterOutputs } from '@/context/trpc-context';
import { useServerPage } from '@/hooks/useServerPage';

/** Which page of a table to read, and how. */
export type DataRowsQuery = RouterInputs['data']['queryRows'];
export type DataRowsPage = RouterOutputs['data']['queryRows'];

const NO_ROWS: DataRowsPage = { rows: [], total: 0 };

/** One page of a table, read through the backend's read-only data inspector. */
export function useDataRows(query: DataRowsQuery) {
  return useServerPage(
    (trpc, input: DataRowsQuery, opts) => trpc.data.queryRows.query(input, opts),
    query,
    NO_ROWS
  );
}
