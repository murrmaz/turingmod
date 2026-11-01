import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { URL_PARAMS } from '@/constants/pages';
import { DEFAULT_PAGE_SIZE } from '@/constants/paging';
import { FEED_CATEGORY_EVENTS, toFeedRow } from '@/lib/activityFormat';
import { type DateRange, rangeStart } from '@/lib/dateRange';
import { useActivityHistory } from './useActivityHistory';
import { useDebounced } from './useDebounced';

/** A category the stored log has (every one but chat, which isn't stored), or all of them. */
export type HistoryCategory = keyof typeof FEED_CATEGORY_EVENTS | 'all';

/**
 * What the History page shows of the stored log: its category, time range and search, the page of
 * rows they read, and the entry open. The search lives in the URL, so a link can open History on
 * one. Changing what's read goes back to the first page with nothing open.
 */
export function useHistoryView() {
  const [params, setParams] = useSearchParams();
  const [category, setCategoryValue] = useState<HistoryCategory>('all');
  const [range, setRangeValue] = useState<DateRange>('all');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSizeValue] = useState(DEFAULT_PAGE_SIZE);
  const [selectedId, select] = useState<string | null>(null);
  const query = params.get(URL_PARAMS.historySearch) ?? '';

  const since = rangeStart(range);
  const { entries, total, loading, error } = useActivityHistory({
    page,
    pageSize,
    ...(category === 'all' ? {} : { events: FEED_CATEGORY_EVENTS[category] }),
    ...(query.trim() ? { search: query.trim() } : {}),
    ...(since === undefined ? {} : { since }),
  });
  const rows = useMemo(() => entries.map(toFeedRow), [entries]);

  /** Show `next` page with nothing open. */
  const goTo = useCallback((next: number) => {
    setPage(next);
    select(null);
  }, []);

  const setCategory = useCallback(
    (next: HistoryCategory) => {
      setCategoryValue(next);
      goTo(0);
    },
    [goTo]
  );
  const setRange = useCallback(
    (next: DateRange) => {
      setRangeValue(next);
      goTo(0);
    },
    [goTo]
  );
  const setPageSize = useCallback(
    (size: number) => {
      setPageSizeValue(size);
      goTo(0);
    },
    [goTo]
  );
  const viewUser = useCallback(
    (user: string) => {
      goTo(0);
      setParams({ [URL_PARAMS.historySearch]: user });
    },
    [goTo, setParams]
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
    goTo(0);
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
    page,
    goTo,
    pageSize,
    setPageSize,
    selectedId,
    select,
    viewUser,
  };
}
