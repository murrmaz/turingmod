import type { DataTableInfo, DataTablesPayload } from '@turingmod/shared';
import { createMessage, MessageType, messageOf } from '@turingmod/shared';
import { useCallback, useEffect, useState } from 'react';
import { useWebSocketContext } from '@/context/WebSocketContext';

/** The tables the Data page can show, with their row counts. Re-read on connect and on demand. */
export function useDataTables() {
  const { sendAndWaitForResponse, isConnected } = useWebSocketContext();
  const [tables, setTables] = useState<DataTableInfo[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await sendAndWaitForResponse<DataTablesPayload>(
        createMessage(MessageType.DATA_LIST_TABLES, {})
      );
      setTables(response.payload.tables);
      setError(null);
    } catch (caught) {
      setError(messageOf(caught));
    }
  }, [sendAndWaitForResponse]);

  useEffect(() => {
    if (isConnected) {
      void refresh();
    }
  }, [isConnected, refresh]);

  return { tables, error, refresh };
}
