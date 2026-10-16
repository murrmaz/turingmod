import type {
  ActivityListPayload,
  ActivityLogEntry,
  EventNotificationPayload,
} from '@turingmod/shared';
import { createActivityQueryMessage, MessageType } from '@turingmod/shared';
import { useCallback, useEffect, useState } from 'react';
import { type FeedRow, toFeedRow } from '../constants/activityFormat';
import { useWebSocketContext } from '../context/WebSocketContext';
import { useWebSocketMessage } from './useWebSocket';

const MAX_ENTRIES = 1000;
const SEED_LIMIT = 200;

/** A feed row plus when this console received it, which the feed's pause and highlight use. */
export interface LiveFeedRow extends FeedRow {
  /** Increases with every row received, so "newer than what's on screen" is one comparison. */
  seq: number;
  /** When it arrived live; null for rows seeded from the stored log. */
  receivedAt: number | null;
}

let nextSeq = 0;

function toLiveRow(entry: ActivityLogEntry, live: boolean): LiveFeedRow {
  nextSeq += 1;
  return { ...toFeedRow(entry), seq: nextSeq, receivedAt: live ? Date.now() : null };
}

/**
 * Live activity feed for the Dashboard, newest first. Seeded on mount and on every reconnect from
 * the stored activity log, then prepended to from live EVENT_NOTIFICATION broadcasts (which, unlike
 * the stored log, include chat).
 */
export function useLiveLog() {
  const { sendAndWaitForResponse, isConnected } = useWebSocketContext();
  const [rows, setRows] = useState<LiveFeedRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isConnected) {
      return;
    }
    let cancelled = false;

    (async () => {
      try {
        const response = await sendAndWaitForResponse<ActivityListPayload>(
          createActivityQueryMessage({ limit: SEED_LIMIT })
        );
        if (!cancelled) {
          // The server answers newest first, which is the feed's order; numbering goes oldest
          // first so that a newer row always has the higher seq.
          const seeded = [...response.payload.entries]
            .reverse()
            .map((entry) => toLiveRow(entry, false))
            .reverse();
          // Rows that arrived live while this was loading stay on top, unless the seed has them.
          setRows((previous) => {
            const known = new Set(seeded.map((row) => row.id));
            const live = previous.filter((row) => row.receivedAt !== null && !known.has(row.id));
            return [...live, ...seeded].slice(0, MAX_ENTRIES);
          });
        }
      } catch (error) {
        console.error('[useLiveLog] Failed to seed activity log', error);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isConnected, sendAndWaitForResponse]);

  useWebSocketMessage<EventNotificationPayload>(
    MessageType.EVENT_NOTIFICATION,
    useCallback((message) => {
      const row = toLiveRow(message.payload.entry, true);
      setRows((previous) => [row, ...previous].slice(0, MAX_ENTRIES));
    }, [])
  );

  return { rows, loading };
}
