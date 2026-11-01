import { getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { useMemo } from 'react';
import { activityColumns } from '@/components/activity/activity-columns';
import { EventSheet } from '@/components/activity/event-sheet';
import { FeedCategoryTabs } from '@/components/activity/feed-category-tabs';
import { DataTable } from '@/components/data-table/data-table';
import { DataTablePagination } from '@/components/data-table/pagination';
import { DateRangeSelect } from '@/components/date-range-select';
import { PageHeader } from '@/components/page-header';
import { PageLayout } from '@/components/page-layout';
import { SearchInput } from '@/components/search-input';
import { DATA_PAGE_SIZES } from '@/constants/paging';
import { useHistoryView } from '@/hooks/useHistoryView';
import { dayDivider, type FeedCategory, type FeedRow } from '@/lib/activityFormat';
import { plural } from '@/lib/plural';

const CATEGORIES = ['command', 'reward', 'viewer', 'system'] as const satisfies FeedCategory[];

/**
 * The stored activity log, searchable and paged by the server. Chat isn't stored, so it's only on
 * the Dashboard's live feed.
 */
export function HistoryPage() {
  const view = useHistoryView();
  const { select, viewUser } = view;

  const columns = useMemo(
    () => activityColumns<FeedRow>({ onInspect: (row) => select(row.id), onViewUser: viewUser }),
    [select, viewUser]
  );
  const table = useReactTable({
    data: view.rows,
    columns,
    getRowId: (row) => row.id,
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
    enableSorting: false,
  });

  return (
    <PageLayout>
      <PageHeader
        title="History"
        description="Everything TuringMod recorded: commands, rewards, viewers and status changes. Chat is live only."
      />
      <div className="flex flex-wrap items-center gap-2">
        <FeedCategoryTabs
          categories={CATEGORIES}
          value={view.category}
          onChange={view.setCategory}
        />
        <SearchInput
          value={view.search}
          onChange={(event) => view.setSearch(event.target.value)}
          placeholder="Search events, users…"
          className="ml-auto w-64"
        />
        <DateRangeSelect value={view.range} onChange={view.setRange} />
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border">
        <DataTable
          table={table}
          divider={dayDivider}
          loading={view.loading}
          onRowClick={(row) => select(row.id)}
          selectedRowId={view.selectedId}
          empty={view.error ?? 'No activity recorded for this filter.'}
        />
      </div>
      <DataTablePagination
        page={view.page}
        pageCount={Math.ceil(view.total / view.pageSize)}
        onPageChange={view.goTo}
        pageSize={view.pageSize}
        pageSizes={DATA_PAGE_SIZES}
        onPageSizeChange={view.setPageSize}
        summary={plural(view.total, 'event')}
      />
      <EventSheet
        rows={view.rows}
        selectedId={view.selectedId}
        onSelect={select}
        onViewUser={viewUser}
      />
    </PageLayout>
  );
}
