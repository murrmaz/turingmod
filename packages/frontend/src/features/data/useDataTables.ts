import type { DataTableInfo } from '@turingmod/shared';
import { MessageType } from '@turingmod/shared';
import { useServerState } from '@/hooks/useServerState';

const NO_TABLES: DataTableInfo[] = [];

/** The tables the Data page can show, with their row counts. */
export function useDataTables() {
  const { state, error } = useServerState(MessageType.DATA_LIST_TABLES, {
    payload: {},
    initial: NO_TABLES,
    onReply: (reply) => reply.tables,
  });
  return { tables: state, error };
}
