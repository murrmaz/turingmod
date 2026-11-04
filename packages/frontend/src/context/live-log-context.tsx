import type { ActivityLogEntry } from '@turingmod/shared';
import type { ReactNode } from 'react';
import { createContext, useContext, useMemo } from 'react';
import type { RouterOutputs } from '@/context/trpc-context';
import { useSubscription } from '@/hooks/useSubscription';
import { type FeedRow, toFeedRow } from '@/lib/activityFormat';
import type { LoadStatus } from '@/lib/loadStatus';

/**
 * How many rows the feed keeps of each kind. Apart, since chat arrives far faster than anything
 * else: under one limit, a busy chat would push out every command, reward and status change.
 */
const MAX_CHAT_ROWS = 1000;
const MAX_EVENT_ROWS = 1000;

/** What `activity.feed` sends: the stored log to start from, then each entry as it's made. */
type FeedEvent = RouterOutputs['activity']['feed'] extends AsyncIterable<infer E> ? E : never;

/** A feed row plus when this console received it, which the feed's pause and highlight use. */
export interface LiveFeedRow extends FeedRow {
  /** Increases with every row received, so "newer than what's on screen" is one comparison. */
  seq: number;
  /** When it arrived live; null for rows seeded from the stored log. */
  receivedAt: number | null;
}

export interface LiveLog {
  /** Every row kept, latest received first. */
  rows: LiveFeedRow[];
  status: LoadStatus;
}

const LiveLogContext = createContext<LiveLog | null>(null);
const NO_ROWS: LiveFeedRow[] = [];

// Rows are numbered as they're made, inside state updates. React may run an update twice in
// development, which skips numbers; only their order matters.
let nextSeq = 0;

function toLiveRow(entry: ActivityLogEntry, live: boolean): LiveFeedRow {
  nextSeq += 1;
  return { ...toFeedRow(entry), seq: nextSeq, receivedAt: live ? Date.now() : null };
}

/** The newest rows of each kind, given rows latest received first. */
function withinLimits(rows: LiveFeedRow[]): LiveFeedRow[] {
  let chat = 0;
  let events = 0;
  return rows.filter((row) => {
    if (row.category === 'chat') {
      chat += 1;
      return chat <= MAX_CHAT_ROWS;
    }
    events += 1;
    return events <= MAX_EVENT_ROWS;
  });
}

/**
 * The stored log as the feed's rows, plus rows that arrived live and aren't in it, latest received
 * first. A row this console already has keeps its number, so one a reconnect sends again isn't
 * news to a feed that's holding still.
 */
function withSeed(previous: LiveFeedRow[], entries: ActivityLogEntry[]): LiveFeedRow[] {
  const had = new Map(previous.map((row) => [row.id, row]));
  // The server answers newest first; numbering goes oldest first so that a newer row always has
  // the higher seq.
  const seeded = [...entries]
    .reverse()
    .map((entry) => had.get(entry.id) ?? toLiveRow(entry, false));
  const known = new Set(seeded.map((row) => row.id));
  const live = previous.filter((row) => row.receivedAt !== null && !known.has(row.id));
  return withinLimits([...live, ...seeded].sort((a, b) => b.seq - a.seq));
}

/** The feed after one event from `activity.feed`. */
function applyFeedEvent(rows: LiveFeedRow[], event: FeedEvent): LiveFeedRow[] {
  return event.type === 'seed'
    ? withSeed(rows, event.entries)
    : withinLimits([toLiveRow(event.entry, true), ...rows]);
}

/**
 * The live activity feed, collected whichever page is open: chat and other live-only events aren't
 * stored, so a feed that only listened while the Dashboard was open would lose them. Seeded from
 * the stored activity log on every subscribe (on opening the console, on every reconnect and after
 * a failure), then prepended to with each entry as it's made.
 */
export function LiveLogProvider({ children }: { children: ReactNode }) {
  const [rows, , status] = useSubscription(
    (trpc, on) => trpc.activity.feed.subscribe(undefined, on),
    NO_ROWS,
    "Couldn't load recent activity",
    applyFeedEvent
  );
  const value = useMemo(() => ({ rows, status }), [rows, status]);
  return <LiveLogContext.Provider value={value}>{children}</LiveLogContext.Provider>;
}

/** The live activity feed; see LiveLogProvider. */
export function useLiveLog(): LiveLog {
  const context = useContext(LiveLogContext);
  if (!context) {
    throw new Error('useLiveLog must be used within LiveLogProvider');
  }
  return context;
}
