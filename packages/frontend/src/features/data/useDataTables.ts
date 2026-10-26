import type { DataTableInfo } from '@turingmod/shared';
import { useServerQuery } from '@/hooks/useServerQuery';

const NO_TABLES: DataTableInfo[] = [];

/** The tables the Data page can show, with their row counts. */
export function useDataTables() {
  const { data, error } = useServerQuery(
    (trpc, _input, opts) => trpc.data.listTables.query(undefined, opts),
    { input: undefined, initial: NO_TABLES }
  );
  return { tables: data, error };
}
