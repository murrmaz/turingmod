import type { ActivityLogEntry } from '@turingmod/shared';
import { MessageType } from '@turingmod/shared';
import { type FeedRow, toFeedRow } from '../constants/activityFormat';
import { useServerState } from './useServerState';

const MAX_ENTRIES = 1000;
const SEED_LIMIT = 200;

/** A feed row plus when this console received it, which the feed's pause and highlight use. */
export interface LiveFeedRow extends FeedRow {
  /** Increases with every row received, so "newer than what's on screen" is one comparison. */
  seq: number;
  /** When it arrived live; null for rows seeded from the stored log. */
  receivedAt: number | null;
}

const NO_ROWS: LiveFeedRow[] = [];

// Rows are numbered as they're made, inside state updates. React may run an update twice in
// development, which skips numbers; only their order matters.
let nextSeq = 0;

function toLiveRow(entry: ActivityLogEntry, live: boolean): LiveFeedRow {
  nextSeq += 1;
  return { ...toFeedRow(entry), seq: nextSeq, receivedAt: live ? Date.now() : null };
}

/** The stored log as the feed's rows, keeping rows that arrived live and aren't in it on top. */
function withSeed(previous: LiveFeedRow[], entries: ActivityLogEntry[]): LiveFeedRow[] {
  // The server answers newest first, which is the feed's order; numbering goes oldest first so
  // that a newer row always has the higher seq.
  const seeded = [...entries]
    .reverse()
    .map((entry) => toLiveRow(entry, false))
    .reverse();
  const known = new Set(seeded.map((row) => row.id));
  const live = previous.filter((row) => row.receivedAt !== null && !known.has(row.id));
  return [...live, ...seeded].slice(0, MAX_ENTRIES);
}

/**
 * Live activity feed for the Dashboard, newest first. Seeded on mount and on every reconnect from
 * the stored activity log, then prepended to from live EVENT_NOTIFICATION broadcasts (which, unlike
 * the stored log, include chat).
 */
export function useLiveLog() {
  const { state: rows, loading } = useServerState(MessageType.ACTIVITY_QUERY, {
    payload: { limit: SEED_LIMIT },
    initial: NO_ROWS,
    onReply: (reply, current) => withSeed(current, reply.entries),
    push: {
      type: MessageType.EVENT_NOTIFICATION,
      apply: ({ entry }, current) => [toLiveRow(entry, true), ...current].slice(0, MAX_ENTRIES),
    },
    errorTitle: "Couldn't load recent activity",
  });
  return { rows, loading };
}
