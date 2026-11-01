import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { matchesFeedQuery } from '@/lib/activityFormat';
import { type FeedTab, showsUnder } from '@/lib/liveFeed';
import { useLiveLog } from './useLiveLog';

/** Scrolled further from the top than this, the feed holds still. */
const SCROLLED_AWAY_PX = 8;

/**
 * The live feed as the Dashboard shows it: the rows under the chosen tab that match the filter,
 * newest first. While it's paused, or scrolled away from the top, it holds still, so nothing moves
 * under the streamer's pointer, and counts the newer rows waiting (`pending`) until they resume
 * or jump back to the latest. `all` is every row received, for counting.
 */
export function useLiveFeed() {
  const { rows, loading } = useLiveLog();
  const [tab, setTab] = useState<FeedTab>('all');
  const [query, setQuery] = useState('');
  const [paused, setPaused] = useState(false);
  const [scrolledAway, setScrolledAway] = useState(false);
  /** While held, the newest row (by seq) that was on screen; later rows wait. */
  const [heldAt, setHeldAt] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const matching = useMemo(
    () => rows.filter((row) => showsUnder(row, tab) && matchesFeedQuery(row, query)),
    [rows, tab, query]
  );

  const held = paused || scrolledAway;
  useEffect(() => {
    setHeldAt((current) => (held ? (current ?? rows[0]?.seq ?? 0) : null));
  }, [held, rows]);

  // Memoized: a new array per render is new table data, and TanStack Table answers new data by
  // resetting its page index, a state change that renders again, endlessly.
  const visible = useMemo(
    () => (heldAt === null ? matching : matching.filter((row) => row.seq <= heldAt)),
    [matching, heldAt]
  );

  const togglePaused = useCallback(() => setPaused((current) => !current), []);
  const onScroll = useCallback(
    (element: HTMLElement) => setScrolledAway(element.scrollTop > SCROLLED_AWAY_PX),
    []
  );
  const jumpToLatest = useCallback(() => {
    scrollRef.current?.scrollTo({ top: 0 });
    setScrolledAway(false);
    setPaused(false);
  }, []);

  return {
    all: rows,
    visible,
    pending: matching.length - visible.length,
    loading,
    tab,
    setTab,
    query,
    setQuery,
    /** A tab or text narrows what's shown. */
    filtered: tab !== 'all' || query !== '',
    paused,
    togglePaused,
    scrollRef,
    onScroll,
    jumpToLatest,
  };
}
