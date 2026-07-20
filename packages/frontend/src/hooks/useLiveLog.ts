import type {
  ActivityLogEntry,
  EventNotificationPayload,
  IWebSocketMessage,
} from '@turingmod/shared';
import { type ActivityCategory, createActivityQueryMessage, MessageType } from '@turingmod/shared';
import { useCallback, useEffect, useState } from 'react';
import { useWebSocketContext } from '../context/WebSocketContext';

const MAX_ENTRIES = 500;
const SEED_LIMIT = 100;

/**
 * Live activity tail for the Dashboard. Ephemeral, client-side ring buffer — seeded on
 * mount/reconnect from the persisted activity_log, then appended to from live
 * EVENT_NOTIFICATION broadcasts (which also include chat, unlike the persisted log).
 */
export function useLiveLog() {
  const { subscribe, sendAndWaitForResponse, isConnected } = useWebSocketContext();
  const [entries, setEntries] = useState<ActivityLogEntry[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<Set<ActivityCategory>>(new Set());

  // Seed from persisted history on mount and on every reconnect.
  useEffect(() => {
    if (!isConnected) {
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const response = await sendAndWaitForResponse<{ entries: ActivityLogEntry[] }>(
          createActivityQueryMessage({ limit: SEED_LIMIT })
        );
        if (!cancelled) {
          // Server returns most-recent-first; the live tail renders oldest-first (chat at bottom).
          setEntries([...response.payload.entries].reverse());
        }
      } catch (error) {
        console.error('[useLiveLog] Failed to seed activity log', error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isConnected, sendAndWaitForResponse]);

  // Append live broadcasts.
  useEffect(() => {
    const unsubscribe = subscribe((message: IWebSocketMessage) => {
      if (message.type !== MessageType.EVENT_NOTIFICATION) {
        return;
      }
      const { entry } = message.payload as EventNotificationPayload;
      setEntries((prev) => {
        const updated = [...prev, entry];
        return updated.length > MAX_ENTRIES ? updated.slice(updated.length - MAX_ENTRIES) : updated;
      });
    });

    return unsubscribe;
  }, [subscribe]);

  const toggleCategory = useCallback((category: ActivityCategory) => {
    setCategoryFilter((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  }, []);

  const visibleEntries =
    categoryFilter.size === 0
      ? entries
      : entries.filter((entry) => categoryFilter.has(entry.category));

  return {
    entries: visibleEntries,
    categoryFilter,
    toggleCategory,
  };
}
