import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { URL_PARAMS } from '@/constants/pages';
import { useDebounced } from '@/hooks/useDebounced';
import { usePagedView } from '@/hooks/usePagedView';
import { FEED_CATEGORY_EVENTS, toFeedRow } from '@/lib/activityFormat';
import { type DateRange, rangeStart } from '@/lib/dateRange';
import { useActivityHistory } from './useActivityHistory';

/** A category the stored log has (every one but chat, which isn't stored), or all of them. */
export type HistoryCategory = keyof typeof FEED_CATEGORY_EVENTS | 'all';

/**
 * What the History page shows of the stored log: its category, time range and search, the page of
 * rows they read, and the entry open. The search lives in the URL, so a link can open History on
 * one.
 */
export function useHistoryView() {
  const [params, setParams] = useSearchParams();
  const [category, setCategory] = useState<HistoryCategory>('all');
  const [range, setRange] = useState<DateRange>('all');
  const query = params.get(URL_PARAMS.historySearch) ?? '';
  const { page, goTo, pageSize, selected, select, pagination } = usePagedView({
    category,
    range,
    query: query.trim(),
  });

  const since = rangeStart(range);
  const { entries, total, loading, error } = useActivityHistory({
    page,
    pageSize,
    ...(category === 'all' ? {} : { events: FEED_CATEGORY_EVENTS[category] }),
    ...(query.trim() ? { search: query.trim() } : {}),
    ...(since === undefined ? {} : { since }),
  });
  const rows = useMemo(() => entries.map(toFeedRow), [entries]);

  const viewUser = useCallback(
    (user: string) => {
      // Done here too for the viewer already searched for, whose URL doesn't change.
      goTo(0);
      select(null);
      setParams({ [URL_PARAMS.historySearch]: user });
    },
    [goTo, select, setParams]
  );

  // What's typed in the search box. The URL's `q`, which the query reads, follows it once typing
  // pauses, replacing the browser history entry rather than adding one per keystroke. When the
  // URL changes any other way (View someone's history, Back), the box is set from it.
  const [search, setSearch] = useState(query);
  const typed = useDebounced(search.trim());
  const lastWritten = useRef(query);
  const writeQuery = useEffectEvent((next: string) => {
    if (next === query) {
      return;
    }
    lastWritten.current = next;
    setParams(next ? { [URL_PARAMS.historySearch]: next } : {}, { replace: true });
  });
  useEffect(() => writeQuery(typed), [typed]);
  useEffect(() => {
    if (query !== lastWritten.current) {
      lastWritten.current = query;
      setSearch(query);
    }
  }, [query]);

  return {
    rows,
    total,
    loading,
    error,
    category,
    setCategory,
    range,
    setRange,
    search,
    setSearch,
    pagination: pagination(total),
    selectedId: selected,
    select,
    viewUser,
  };
}
