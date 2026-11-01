import {
  getCoreRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
} from '@tanstack/react-table';
import { ArrowUp, Pause, Play } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { activityColumns } from '@/components/activity/activity-columns';
import { EventSheet } from '@/components/activity/event-sheet';
import { FeedCategoryTabs } from '@/components/activity/feed-category-tabs';
import { DataTable } from '@/components/data-table/data-table';
import { SearchInput } from '@/components/search-input';
import { Button } from '@/components/ui/button';
import { links } from '@/constants/pages';
import { useFocusShortcut } from '@/hooks/useFocusShortcut';
import { useLiveFeed } from '@/hooks/useLiveFeed';
import type { LiveFeedRow } from '@/hooks/useLiveLog';
import { usePlatformLiveState } from '@/hooks/usePlatformLiveState';
import { dayDivider, type FeedCategory } from '@/lib/activityFormat';
import { countEvents, streamStartedAt } from '@/lib/liveFeed';
import { HealthRail } from './health-rail';

/** The feed's tabs after All, in order. All leaves chat out: it would bury everything else mid-stream. */
const CATEGORIES: readonly FeedCategory[] = ['command', 'reward', 'viewer', 'system', 'chat'];

/** How long a row that just arrived stays highlighted. */
const HIGHLIGHT_MS = 2000;

const plural = (count: number, one: string) =>
  `${count.toLocaleString()} ${one}${count === 1 ? '' : 's'}`;

export function DashboardPage() {
  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_300px]">
      <LiveActivity />
      <HealthRail />
    </div>
  );
}

/** The live feed (useLiveFeed), its table, and the sheet that opens on one of its rows. */
function LiveActivity() {
  const navigate = useNavigate();
  const feed = useLiveFeed();
  const streamStart = streamStartedAt(usePlatformLiveState());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sorting, setSorting] = useState<SortingState>([{ id: 'time', desc: true }]);
  const searchRef = useRef<HTMLInputElement | null>(null);
  useFocusShortcut(searchRef);

  const viewUser = useCallback((user: string) => navigate(links.historyOf(user)), [navigate]);
  const columns = useMemo(
    () =>
      activityColumns<LiveFeedRow>({
        onInspect: (row) => setSelectedId(row.id),
        onViewUser: viewUser,
      }),
    [viewUser]
  );
  const table = useReactTable({
    data: feed.visible,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getRowId: (row) => row.id,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });
  const shown = table.getRowModel().rows.map((row) => row.original);
  const now = Date.now();

  return (
    <section className="relative flex min-h-[420px] min-w-0 flex-col overflow-hidden rounded-xl border">
      <header className="flex flex-col gap-3 px-4 pt-4 pb-3">
        <div className="flex items-baseline gap-3 whitespace-nowrap">
          <h2 className="text-base font-semibold">Live activity</h2>
          <span className="truncate text-body text-muted-foreground">
            Newest first · {plural(countEvents(feed.all, streamStart), 'event')}
            {streamStart === null ? '' : ' this stream'}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <FeedCategoryTabs categories={CATEGORIES} value={feed.tab} onChange={feed.setTab} />
          <SearchInput
            ref={searchRef}
            value={feed.query}
            onChange={(event) => feed.setQuery(event.target.value)}
            placeholder="Filter events…"
            className="ml-auto w-56"
          />
          <Button variant="outline" onClick={feed.togglePaused}>
            {feed.paused ? <Play /> : <Pause />}
            {feed.paused ? 'Resume' : 'Pause'}
          </Button>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1 flex-col border-t">
        {feed.pending > 0 && (
          <Button
            size="sm"
            onClick={feed.jumpToLatest}
            className="absolute top-12 left-1/2 z-20 -translate-x-1/2 rounded-full shadow-lg"
          >
            <ArrowUp />
            {plural(feed.pending, 'new event')}
          </Button>
        )}
        <DataTable
          table={table}
          divider={dayDivider}
          virtualize
          loading={feed.loading}
          scrollRef={feed.scrollRef}
          onScroll={feed.onScroll}
          onRowClick={(row) => setSelectedId(row.id)}
          selectedRowId={selectedId}
          rowClassName={(row) =>
            row.receivedAt !== null && now - row.receivedAt < HIGHLIGHT_MS
              ? 'animate-row-arrive'
              : undefined
          }
          empty={
            feed.filtered
              ? 'Nothing matches this filter.'
              : 'No activity yet — events appear here as they happen.'
          }
        />
      </div>

      <EventSheet
        rows={shown}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onViewUser={viewUser}
      />
    </section>
  );
}
