import type { ActivityLogEntry } from '@turingmod/shared';
import type { RouterOutputs } from '@/context/trpc-context';
import { type FeedRow, toFeedRow } from '@/lib/activityFormat';
import { useSubscription } from './useSubscription';

const MAX_ENTRIES = 1000;

/** What `activity.feed` sends: the stored log to start from, then each entry as it's made. */
type FeedEvent = RouterOutputs['activity']['feed'] extends AsyncIterable<infer E> ? E : never;

/** A feed row plus when this console received it, which the feed's pause and highlight use. */
export interface LiveFeedRow extends FeedRow {
  /** Increases with every row received, so "newer than what's on screen" is one comparison. */
  seq: number;
  /** When it arrived live; null for rows seeded from the stored log. */
  receivedAt: number | null;
}

interface LiveLog {
  rows: LiveFeedRow[];
  /** Until the first seed arrives. */
  loading: boolean;
}

const NOT_LOADED: LiveLog = { rows: [], loading: true };

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

/** The feed after one event from `activity.feed`. */
function applyFeedEvent(current: LiveLog, event: FeedEvent): LiveLog {
  if (event.type === 'seed') {
    return { rows: withSeed(current.rows, event.entries), loading: false };
  }
  return {
    ...current,
    rows: [toLiveRow(event.entry, true), ...current.rows].slice(0, MAX_ENTRIES),
  };
}

/**
 * Live activity feed for the Dashboard, newest first. Seeded on every subscribe, so on mount and
 * on every reconnect, from the stored activity log, then prepended to with each entry as it's made
 * (which, unlike the stored log, include chat).
 */
export function useLiveLog(): LiveLog {
  const [log] = useSubscription(
    (trpc, on) => trpc.activity.feed.subscribe(undefined, on),
    NOT_LOADED,
    "Couldn't load recent activity",
    applyFeedEvent
  );
  return log;
}
