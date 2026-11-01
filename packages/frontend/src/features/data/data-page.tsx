import { getCoreRowModel, useReactTable, type VisibilityState } from '@tanstack/react-table';
import type { DataTableInfo } from '@turingmod/shared';
import { Download, Lock } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { DataTable } from '@/components/data-table/data-table';
import { DataTableFacetedFilter } from '@/components/data-table/faceted-filter';
import { DataTablePagination } from '@/components/data-table/pagination';
import { DataTableViewOptions } from '@/components/data-table/view-options';
import { DateRangeSelect } from '@/components/date-range-select';
import { PageLayout } from '@/components/page-layout';
import { SearchInput } from '@/components/search-input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { links, URL_PARAMS } from '@/constants/pages';
import { useDataTables } from '@/hooks/useDataTables';
import { plural } from '@/lib/plural';
import { inspectorColumns } from './columns';
import { RowPanel } from './row-panel';
import { useInspectedTable } from './useInspectedTable';
import { useTableExport } from './useTableExport';

export function DataPage() {
  const tableName = useParams()[URL_PARAMS.dataTable];
  const { tables, error } = useDataTables();

  if (!tableName) {
    const first = tables[0];
    return first ? (
      <Navigate to={links.dataTable(first.name)} replace />
    ) : (
      <p className="p-8 text-sm text-muted-foreground">{error ?? 'Loading tables…'}</p>
    );
  }
  const info = tables.find((table) => table.name === tableName);
  if (!info) {
    return (
      <p className="p-8 text-sm text-muted-foreground">
        {tables.length === 0 ? (error ?? 'Loading tables…') : `No table named ${tableName}.`}
      </p>
    );
  }
  // Keyed, so switching tables starts from a clean set of filters.
  return <TableInspector key={info.name} info={info} />;
}

/** One table: what's read of it (useInspectedTable), its rows, and the row selected. */
function TableInspector({ info }: { info: DataTableInfo }) {
  const inspected = useInspectedTable(info);
  const { exporting, exportCsv } = useTableExport(info, inspected.query, inspected.total);
  const [visibility, setVisibility] = useState<VisibilityState>({});
  const { total } = inspected;

  const columns = useMemo(() => inspectorColumns(info), [info]);
  const table = useReactTable({
    data: inspected.rows,
    columns,
    state: { sorting: inspected.sorting, columnVisibility: visibility },
    onSortingChange: inspected.setSorting,
    onColumnVisibilityChange: setVisibility,
    manualSorting: true,
    enableMultiSort: false,
    getRowId: (row) => row.rowKey,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <PageLayout
      panel={
        inspected.selected && (
          <RowPanel info={info} row={inspected.selected} onClose={() => inspected.select(null)} />
        )
      }
    >
      <div className="flex items-center gap-3">
        <h2 className="font-mono text-2xl font-semibold">{info.name}</h2>
        <Badge variant="secondary" className="gap-1">
          <Lock className="size-3" />
          Read-only
        </Badge>
        <span className="ml-auto text-sm text-muted-foreground">
          {plural(total, 'row')}
          {total !== info.rowCount && ` of ${info.rowCount.toLocaleString()}`}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          value={inspected.search}
          onChange={(event) => inspected.setSearch(event.target.value)}
          placeholder="Search data…"
          className="w-64"
        />
        {info.columns.map(
          (column) =>
            column.enumValues && (
              <DataTableFacetedFilter
                key={column.name}
                title={column.name}
                options={column.enumValues.map((value) => ({ value, label: value }))}
                selected={inspected.facets[column.name] ?? new Set()}
                onChange={(next) => inspected.setFacet(column.name, next)}
              />
            )
        )}
        {info.columns.some((column) => column.isTimestamp) && (
          <DateRangeSelect value={inspected.range} onChange={inspected.setRange} />
        )}
        <Button
          variant="outline"
          size="sm"
          className="ml-auto h-9"
          onClick={() => void exportCsv()}
          disabled={exporting || total === 0}
        >
          <Download />
          {exporting ? 'Exporting…' : 'Export'}
        </Button>
        <DataTableViewOptions table={table} label="Columns" />
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border">
        <DataTable
          table={table}
          loading={inspected.loading}
          onRowClick={(row) => inspected.select(row.rowKey)}
          selectedRowId={inspected.selectedKey}
          empty={inspected.error ?? 'No rows.'}
        />
      </div>
      <DataTablePagination {...inspected.pagination} />
    </PageLayout>
  );
}
