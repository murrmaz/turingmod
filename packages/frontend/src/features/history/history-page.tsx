import { getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { type ActivityLogEntry, ActivityLogEntrySchema, type DataCell } from '@turingmod/shared';
import { Search } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DataTable } from '@/components/data-table/data-table';
import { DataTablePagination } from '@/components/data-table/pagination';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  FEED_CATEGORY_EVENTS,
  FEED_CATEGORY_LABELS,
  type FeedRow,
  formatDateTime,
  toFeedRow,
} from '@/constants/activityFormat';
import { activityColumns } from '@/features/dashboard/activity-columns';
import { EventSheet } from '@/features/dashboard/event-sheet';
import { DATA_PAGE_SIZES, useDataRows } from '@/hooks/useDataRows';

type HistoryCategory = keyof typeof FEED_CATEGORY_EVENTS | 'all';

const TABS: { value: HistoryCategory; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'command', label: FEED_CATEGORY_LABELS.command },
  { value: 'reward', label: FEED_CATEGORY_LABELS.reward },
  { value: 'viewer', label: FEED_CATEGORY_LABELS.viewer },
  { value: 'system', label: FEED_CATEGORY_LABELS.system },
];

const DAY = 24 * 60 * 60 * 1000;
const RANGES = {
  today: { label: 'Today', since: () => new Date().setHours(0, 0, 0, 0) },
  week: { label: 'Last 7 days', since: () => Date.now() - 7 * DAY },
  month: { label: 'Last 30 days', since: () => Date.now() - 30 * DAY },
  all: { label: 'All time', since: () => undefined },
} as const;
type RangeKey = keyof typeof RANGES;

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
  const [range, setRange] = useState<RangeKey>('all');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const query = params.get('q') ?? '';

  const since = RANGES[range].since();
  // Rounded to the minute, so the request (and the query it causes) changes once a minute.
  const { rows, total, loading, error } = useDataRows({
    table: 'activity_log',
    page,
    pageSize,
    sort: { column: 'timestamp', direction: 'desc' },
    ...(category === 'all' ? {} : { filters: { event: FEED_CATEGORY_EVENTS[category] } }),
    ...(query.trim() ? { search: query.trim() } : {}),
    ...(since === undefined ? {} : { since: Math.floor(since / 60_000) * 60_000 }),
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
      activityColumns<FeedRow>(
        { onInspect: (row) => setSelectedId(row.id), onViewUser: viewUser },
        formatDateTime,
        180
      ),
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
            value={query}
            onChange={(event) => {
              setParams(event.target.value ? { q: event.target.value } : {});
              reset();
            }}
            placeholder="Search events, users…"
            className="pl-8"
          />
        </div>
        <Select
          value={range}
          onValueChange={(value) => {
            setRange(value as RangeKey);
            reset();
          }}
        >
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(RANGES).map(([key, { label }]) => (
              <SelectItem key={key} value={key}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border">
        <DataTable
          table={table}
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
