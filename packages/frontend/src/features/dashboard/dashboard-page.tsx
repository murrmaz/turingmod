import {
  getCoreRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
} from '@tanstack/react-table';
import { ArrowUp, Pause, Play, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DataTable } from '@/components/data-table/data-table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  FEED_CATEGORY_LABELS,
  type FeedCategory,
  type FeedRow,
  matchesFeedQuery,
} from '@/constants/activityFormat';
import { type LiveFeedRow, useLiveLog } from '@/hooks/useLiveLog';
import { usePlatformLiveState } from '@/hooks/usePlatformLiveState';
import { activityColumns } from './activity-columns';
import { EventSheet } from './event-sheet';
import { HealthRail } from './health-rail';

/** Tabs in display order. "all" leaves chat out: it would bury everything else mid-stream. */
const TABS: { value: FeedCategory | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'command', label: FEED_CATEGORY_LABELS.command },
  { value: 'reward', label: FEED_CATEGORY_LABELS.reward },
  { value: 'viewer', label: FEED_CATEGORY_LABELS.viewer },
  { value: 'system', label: FEED_CATEGORY_LABELS.system },
  { value: 'chat', label: FEED_CATEGORY_LABELS.chat },
];

const HIGHLIGHT_MS = 2000;

export function DashboardPage() {
  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_300px]">
      <LiveActivity />
      <HealthRail />
    </div>
  );
}

function LiveActivity() {
  const navigate = useNavigate();
  const { rows, loading } = useLiveLog();
  const platforms = usePlatformLiveState();
  const [category, setCategory] = useState<FeedCategory | 'all'>('all');
  const [query, setQuery] = useState('');
  const [paused, setPaused] = useState(false);
  const [scrolledAway, setScrolledAway] = useState(false);
  /** While frozen, the newest seq on screen; rows after it wait behind the "new events" pill. */
  const [frozenAt, setFrozenAt] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sorting, setSorting] = useState<SortingState>([{ id: 'time', desc: true }]);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const matching = useMemo(
    () =>
      rows.filter(
        (row) =>
          (category === 'all' ? row.category !== 'chat' : row.category === category) &&
          matchesFeedQuery(row, query)
      ),
    [rows, category, query]
  );

  const frozen = paused || scrolledAway;
  useEffect(() => {
    setFrozenAt((current) => (frozen ? (current ?? rows[0]?.seq ?? 0) : null));
  }, [frozen, rows]);

  const visible = frozenAt === null ? matching : matching.filter((row) => row.seq <= frozenAt);
  const pending = matching.length - visible.length;

  const jumpToLatest = () => {
    scrollRef.current?.scrollTo({ top: 0 });
    setScrolledAway(false);
    setPaused(false);
  };

  // "/" focuses the filter, as long as nothing else is being typed into.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target?.closest('input, textarea, select, [contenteditable="true"]');
      if (event.key === '/' && !typing) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const viewUser = useCallback(
    (user: string) => navigate(`/history?q=${encodeURIComponent(user)}`),
    [navigate]
  );
  const columns = useMemo(
    () =>
      activityColumns<LiveFeedRow>({
        onInspect: (row: FeedRow) => setSelectedId(row.id),
        onViewUser: viewUser,
      }),
    [viewUser]
  );

  const table = useReactTable({
    data: visible,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getRowId: (row) => row.id,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const ordered = table.getRowModel().rows.map((row) => row.original);
  const selected = ordered.find((row) => row.id === selectedId) ?? null;
  const step = useCallback(
    (direction: -1 | 1) => {
      setSelectedId((current) => {
        const index = ordered.findIndex((row) => row.id === current);
        return ordered[index + direction]?.id ?? current;
      });
    },
    [ordered]
  );

  // Counted from when the earliest live platform went live; everything loaded, when offline.
  const streamStart = platforms
    .filter((platform) => platform.live && platform.startedAt !== null)
    .reduce<number | null>(
      (earliest, platform) =>
        earliest === null || (platform.startedAt ?? earliest) < earliest
          ? platform.startedAt
          : earliest,
      null
    );
  const eventCount =
    streamStart === null
      ? rows.filter((row) => row.category !== 'chat').length
      : rows.filter((row) => row.category !== 'chat' && row.timestamp >= streamStart).length;
  const now = Date.now();

  return (
    <section className="relative flex min-h-[420px] min-w-0 flex-col overflow-hidden rounded-xl border">
      <header className="flex flex-col gap-3 px-4 pt-4 pb-3">
        <div className="flex items-baseline gap-3 whitespace-nowrap">
          <h2 className="text-base font-semibold">Live activity</h2>
          <span className="truncate text-[13px] text-muted-foreground">
            Newest first · {eventCount.toLocaleString()} events
            {streamStart === null ? '' : ' this stream'}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Tabs value={category} onValueChange={(value) => setCategory(value as typeof category)}>
            <TabsList>
              {TABS.map((tab) => (
                <TabsTrigger key={tab.value} value={tab.value} className="px-3 text-[13px]">
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <div className="relative ml-auto w-56">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter events…"
              className="pl-8"
            />
          </div>
          <Button variant="outline" onClick={() => setPaused((value) => !value)}>
            {paused ? <Play /> : <Pause />}
            {paused ? 'Resume' : 'Pause'}
          </Button>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1 flex-col border-t">
        {pending > 0 && (
          <Button
            size="sm"
            onClick={jumpToLatest}
            className="absolute top-12 left-1/2 z-20 -translate-x-1/2 rounded-full shadow-lg"
          >
            <ArrowUp />
            {pending} new {pending === 1 ? 'event' : 'events'}
          </Button>
        )}
        <DataTable
          table={table}
          virtualize
          loading={loading}
          scrollRef={scrollRef}
          onScroll={(element) => setScrolledAway(element.scrollTop > 8)}
          onRowClick={(row) => setSelectedId(row.id)}
          selectedRowId={selectedId}
          rowClassName={(row) =>
            row.receivedAt !== null && now - row.receivedAt < HIGHLIGHT_MS
              ? 'animate-row-arrive'
              : undefined
          }
          empty={
            query || category !== 'all'
              ? 'Nothing matches this filter.'
              : 'No activity yet — events appear here as they happen.'
          }
        />
      </div>

      <EventSheet
        row={selected}
        onClose={() => setSelectedId(null)}
        onStep={step}
        onViewUser={viewUser}
      />
    </section>
  );
}
