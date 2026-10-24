import type { DataTableInfo } from '@turingmod/shared';
import { MessageType, messageOf } from '@turingmod/shared';
import { useCallback, useEffect, useState } from 'react';
import { useWebSocketContext } from '@/context/WebSocketContext';

/** The tables the Data page can show, with their row counts. Re-read on connect and on demand. */
export function useDataTables() {
  const { request, isConnected } = useWebSocketContext();
  const [tables, setTables] = useState<DataTableInfo[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const { tables } = await request(MessageType.DATA_LIST_TABLES, {});
      setTables(tables);
      setError(null);
    } catch (caught) {
      setError(messageOf(caught));
    }
  }, [request]);

  useEffect(() => {
    if (isConnected) {
      void refresh();
    }
  }, [isConnected, refresh]);

  return { tables, error, refresh };
}
