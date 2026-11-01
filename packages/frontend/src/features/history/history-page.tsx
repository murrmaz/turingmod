import { getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { activityColumns } from '@/components/activity/activity-columns';
import { EventSheet } from '@/components/activity/event-sheet';
import { FeedCategoryTabs } from '@/components/activity/feed-category-tabs';
import { DataTable } from '@/components/data-table/data-table';
import { DataTablePagination } from '@/components/data-table/pagination';
import { DateRangeSelect } from '@/components/date-range-select';
import { PageHeader } from '@/components/page-header';
import { SearchInput } from '@/components/search-input';
import { URL_PARAMS } from '@/constants/pages';
import { useActivityHistory } from '@/hooks/useActivityHistory';
import { DATA_PAGE_SIZES } from '@/hooks/useDataRows';
import { useDebounced } from '@/hooks/useDebounced';
import { dayDivider, FEED_CATEGORY_EVENTS, type FeedRow, toFeedRow } from '@/lib/activityFormat';
import { type DateRange, rangeStart } from '@/lib/dateRange';

/** A category the stored log has: every one but chat, which isn't stored. */
type StoredCategory = keyof typeof FEED_CATEGORY_EVENTS;
type HistoryCategory = StoredCategory | 'all';

const CATEGORIES: readonly StoredCategory[] = ['command', 'reward', 'viewer', 'system'];

/**
 * The stored activity log, searchable and paged by the server. Chat isn't stored, so it's only on
 * the Dashboard's live feed.
 */
export function HistoryPage() {
  const [params, setParams] = useSearchParams();
  const [category, setCategory] = useState<HistoryCategory>('all');
  const [range, setRange] = useState<DateRange>('all');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const query = params.get(URL_PARAMS.historySearch) ?? '';

  const since = rangeStart(range);
  const { entries, total, loading, error } = useActivityHistory({
    page,
    pageSize,
    ...(category === 'all' ? {} : { events: FEED_CATEGORY_EVENTS[category] }),
    ...(query.trim() ? { search: query.trim() } : {}),
    ...(since === undefined ? {} : { since }),
  });

  const feedRows = useMemo(() => entries.map(toFeedRow), [entries]);

  const viewUser = useCallback(
    (user: string) => {
      setSelectedId(null);
      setPage(0);
      setParams({ [URL_PARAMS.historySearch]: user });
    },
    [setParams]
  );
  const columns = useMemo(
    () =>
      activityColumns<FeedRow>({
        onInspect: (row) => setSelectedId(row.id),
        onViewUser: viewUser,
      }),
    [viewUser]
  );

  const table = useReactTable({
    data: feedRows,
    columns,
    getRowId: (row) => row.id,
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
    enableSorting: false,
  });

  const reset = () => {
    setPage(0);
    setSelectedId(null);
  };

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
    reset();
  });
  useEffect(() => writeQuery(typed), [typed]);
  useEffect(() => {
    if (query !== lastWritten.current) {
      lastWritten.current = query;
      setSearch(query);
    }
  }, [query]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 px-8 py-6">
      <PageHeader
        title="History"
        description="Everything TuringMod recorded: commands, rewards, viewers and status changes. Chat is live only."
      />
      <div className="flex flex-wrap items-center gap-2">
        <FeedCategoryTabs
          categories={CATEGORIES}
          value={category}
          onChange={(next) => {
            setCategory(next);
            reset();
          }}
        />
        <SearchInput
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search events, users…"
          className="ml-auto w-64"
        />
        <DateRangeSelect
          value={range}
          onChange={(next) => {
            setRange(next);
            reset();
          }}
        />
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border">
        <DataTable
          table={table}
          divider={dayDivider}
          loading={loading}
          onRowClick={(row) => setSelectedId(row.id)}
          selectedRowId={selectedId}
          empty={error ?? 'No activity recorded for this filter.'}
        />
      </div>
      <DataTablePagination
        page={page}
        pageCount={Math.ceil(total / pageSize)}
        onPageChange={(next) => {
          setPage(next);
          setSelectedId(null);
        }}
        pageSize={pageSize}
        pageSizes={DATA_PAGE_SIZES}
        onPageSizeChange={(size) => {
          setPageSize(size);
          reset();
        }}
        summary={`${total.toLocaleString()} ${total === 1 ? 'event' : 'events'}`}
      />
      <EventSheet
        rows={feedRows}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onViewUser={viewUser}
      />
    </div>
  );
}
