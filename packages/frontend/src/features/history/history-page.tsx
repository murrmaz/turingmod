import { getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { type ActivityLogEntry, ActivityLogEntrySchema, type DataCell } from '@turingmod/shared';
import { Search } from 'lucide-react';
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DataTable } from '@/components/data-table/data-table';
import { DataTablePagination } from '@/components/data-table/pagination';
import { type DateRange, DateRangeSelect, rangeStart } from '@/components/date-range-select';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  dayDivider,
  FEED_CATEGORY_EVENTS,
  FEED_CATEGORY_LABELS,
  type FeedRow,
  toFeedRow,
} from '@/constants/activityFormat';
import { activityColumns } from '@/features/dashboard/activity-columns';
import { EventSheet } from '@/features/dashboard/event-sheet';
import { DATA_PAGE_SIZES, useDataRows } from '@/hooks/useDataRows';
import { useDebounced } from '@/hooks/useDebounced';

type HistoryCategory = keyof typeof FEED_CATEGORY_EVENTS | 'all';

const TABS: { value: HistoryCategory; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'command', label: FEED_CATEGORY_LABELS.command },
  { value: 'reward', label: FEED_CATEGORY_LABELS.reward },
  { value: 'viewer', label: FEED_CATEGORY_LABELS.viewer },
  { value: 'system', label: FEED_CATEGORY_LABELS.system },
];

/** Back from a stored row to the entry it was saved from; null for a row that isn't one. */
function toEntry(row: Record<string, DataCell>): ActivityLogEntry | null {
  const parsed = ActivityLogEntrySchema.safeParse({ ...row, data: readData(row.data) });
  return parsed.success ? parsed.data : null;
}

/** A stored payload, or an empty one when it can't be read, so the row still shows as its event. */
function readData(data: DataCell | undefined): ActivityLogEntry['data'] {
  try {
    return ActivityLogEntrySchema.shape.data.parse(
      JSON.parse(typeof data === 'string' ? data : '')
    );
  } catch {
    return {};
  }
}

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
  const query = params.get('q') ?? '';

  const since = rangeStart(range);
  const { rows, total, loading, error } = useDataRows({
    table: 'activity_log',
    page,
    pageSize,
    sort: { column: 'timestamp', direction: 'desc' },
    ...(category === 'all' ? {} : { filters: { event: FEED_CATEGORY_EVENTS[category] } }),
    ...(query.trim() ? { search: query.trim() } : {}),
    ...(since === undefined ? {} : { since }),
  });

  const feedRows = useMemo(() => rows.flatMap((row) => toEntry(row) ?? []).map(toFeedRow), [rows]);

  const viewUser = useCallback(
    (user: string) => {
      setSelectedId(null);
      setPage(0);
      setParams({ q: user });
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

  const selected = feedRows.find((row) => row.id === selectedId) ?? null;
  const step = useCallback(
    (direction: -1 | 1) =>
      setSelectedId((current) => {
        const index = feedRows.findIndex((row) => row.id === current);
        return feedRows[index + direction]?.id ?? current;
      }),
    [feedRows]
  );

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
    setParams(next ? { q: next } : {}, { replace: true });
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
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">History</h2>
        <p className="text-sm text-muted-foreground">
          Everything TuringMod recorded: commands, rewards, viewers and status changes. Chat is live
          only.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Tabs
          value={category}
          onValueChange={(value) => {
            setCategory(value as HistoryCategory);
            reset();
          }}
        >
          <TabsList>
            {TABS.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value} className="px-3 text-[13px]">
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="relative ml-auto w-64">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search events, users…"
            className="pl-8"
          />
        </div>
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
        row={selected}
        onClose={() => setSelectedId(null)}
        onStep={step}
        onViewUser={viewUser}
      />
    </div>
  );
}
