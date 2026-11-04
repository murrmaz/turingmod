import type { RouterInputs, RouterOutputs } from '@/context/trpc-context';
import { useServerPage } from '@/hooks/useServerPage';

/** Which page of the stored log to read: events, search, since, page and page size. */
export type ActivityHistoryQuery = RouterInputs['activity']['history'];

const NONE: RouterOutputs['activity']['history'] = { entries: [], total: 0 };

/** One page of the stored activity log, newest first. */
export function useActivityHistory(query: ActivityHistoryQuery) {
  return useServerPage(
    (trpc, input: ActivityHistoryQuery, opts) => trpc.activity.history.query(input, opts),
    query,
    NONE
  );
}
