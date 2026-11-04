import type { TrpcClient } from '@/context/trpc-context';
import { useServerQuery } from './useServerQuery';

/**
 * One page of something paged by the server, read again whenever the query changes. A failed read
 * shows `empty`, with the error for the view to show in its place, rather than a page that's no
 * longer what the query asks for.
 */
export function useServerPage<Query, Page extends object>(
  read: (trpc: TrpcClient, query: Query, options: { signal: AbortSignal }) => Promise<Page>,
  query: Query,
  empty: Page
) {
  const { data, loading, error } = useServerQuery(read, { input: query, initial: empty });
  return { ...(error === null ? data : empty), loading, error };
}
