import type { DataQueryRowsPayload, DataRowsPayload } from '@turingmod/shared';
import { MAX_DATA_PAGE_SIZE, MessageType, messageOf } from '@turingmod/shared';
import { useEffect, useRef, useState } from 'react';
import { useWebSocketContext } from '@/context/WebSocketContext';

/** The page sizes a paged data view offers, up to the most the backend returns in one page. */
export const DATA_PAGE_SIZES = [25, 50, 100, MAX_DATA_PAGE_SIZE];

/**
 * One page of a table, read through the backend's read-only data inspector. Re-reads whenever
 * the request changes (compared by value) or the connection comes back; a reply to an older
 * request is dropped. `null` reads nothing.
 */
export function useDataRows(request: DataQueryRowsPayload | null, refreshKey = 0) {
  const { request: send, isConnected } = useWebSocketContext();
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
    send(MessageType.DATA_QUERY_ROWS, current)
      .then((payload) => {
        if (!cancelled) {
          setResult(payload);
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
  }, [key, isConnected, send, refreshKey]);

  return { ...result, loading, error };
}
