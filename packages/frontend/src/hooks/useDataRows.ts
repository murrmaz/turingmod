import type { DataQueryRowsPayload, DataRowsPayload } from '@turingmod/shared';
import { MAX_DATA_PAGE_SIZE, MessageType } from '@turingmod/shared';
import { useServerState } from './useServerState';

/** The page sizes a paged data view offers, up to the most the backend returns in one page. */
export const DATA_PAGE_SIZES = [25, 50, 100, MAX_DATA_PAGE_SIZE];

const NO_ROWS: DataRowsPayload = { rows: [], total: 0 };

/**
 * One page of a table, read through the backend's read-only data inspector, again whenever the
 * request changes. A failed read shows no rows, with the error for the view to show in their place.
 */
export function useDataRows(request: DataQueryRowsPayload) {
  const { state, loading, error } = useServerState(MessageType.DATA_QUERY_ROWS, {
    payload: request,
    initial: NO_ROWS,
    onReply: (reply) => reply,
  });
  return { ...(error === null ? state : NO_ROWS), loading, error };
}
