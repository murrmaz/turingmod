import type { DataQueryRowsPayload, DataRowsPayload } from '@turingmod/shared';
import { createMessage, MessageType, messageOf } from '@turingmod/shared';
import { useEffect, useRef, useState } from 'react';
import { useWebSocketContext } from '@/context/WebSocketContext';

/**
 * One page of a table, read through the backend's read-only data inspector. Re-reads whenever
 * the request changes (compared by value) or the connection comes back; a reply to an older
 * request is dropped. `null` reads nothing.
 */
export function useDataRows(request: DataQueryRowsPayload | null, refreshKey = 0) {
  const { sendAndWaitForResponse, isConnected } = useWebSocketContext();
  const [result, setResult] = useState<DataRowsPayload>({ rows: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const key = request === null ? null : JSON.stringify(request);
  // Callers build the request afresh each render; the effect runs when its value changes.
  const requestRef = useRef(request);
  requestRef.current = request;

  // biome-ignore lint/correctness/useExhaustiveDependencies: key stands for the request; refreshKey re-reads on demand
  useEffect(() => {
    const current = requestRef.current;
    if (key === null || current === null || !isConnected) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    sendAndWaitForResponse<DataRowsPayload>(createMessage(MessageType.DATA_QUERY_ROWS, current))
      .then((response) => {
        if (!cancelled) {
          setResult(response.payload);
          setError(null);
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(messageOf(caught));
          setResult({ rows: [], total: 0 });
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [key, isConnected, sendAndWaitForResponse, refreshKey]);

  return { ...result, loading, error };
}
