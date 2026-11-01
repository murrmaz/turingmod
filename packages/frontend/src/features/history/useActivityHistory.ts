import type { RouterInputs, RouterOutputs } from '@/context/trpc-context';
import { useServerQuery } from '@/hooks/useServerQuery';

/** Which page of the stored log to read: events, search, since, page and page size. */
export type ActivityHistoryQuery = RouterInputs['activity']['history'];

const NONE: RouterOutputs['activity']['history'] = { entries: [], total: 0 };

/**
 * One page of the stored activity log, newest first, read again whenever the query changes. A
 * failed read shows no entries, with the error for the view to show in their place.
 */
export function useActivityHistory(query: ActivityHistoryQuery) {
  const { data, loading, error } = useServerQuery(
    (trpc, input, opts) => trpc.activity.history.query(input, opts),
    { input: query, initial: NONE }
  );
  return { ...(error === null ? data : NONE), loading, error };
}
