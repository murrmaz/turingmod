import {
  type ColumnDef,
  getCoreRowModel,
  type SortingState,
  useReactTable,
  type VisibilityState,
} from '@tanstack/react-table';
import type {
  DataCell,
  DataColumnInfo,
  DataQueryRowsPayload,
  DataTableInfo,
} from '@turingmod/shared';
import { ActivityCategory, MAX_DATA_PAGE_SIZE, MessageType, messageOf } from '@turingmod/shared';
import { Copy, Download, Lock, Search, Shield, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { DataTableColumnHeader } from '@/components/data-table/column-header';
import { DataTable } from '@/components/data-table/data-table';
import { DataTableFacetedFilter } from '@/components/data-table/faceted-filter';
import { DataTablePagination } from '@/components/data-table/pagination';
import { DataTableViewOptions } from '@/components/data-table/view-options';
import { type DateRange, DateRangeSelect, rangeStart } from '@/components/date-range-select';
import { DotBadge, type Tone } from '@/components/status';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatDateTime } from '@/constants/activityFormat';
import { useWebSocketContext } from '@/context/WebSocketContext';
import { DATA_PAGE_SIZES, useDataRows } from '@/hooks/useDataRows';
import { useDebounced } from '@/hooks/useDebounced';
import { copyToClipboard } from '@/lib/reportError';
import { toCsv } from './csv';
import { useDataTables } from './useDataTables';

/** A row of the current page, keyed by its position since tables need not have one id column. */
interface DataRow {
  rowKey: string;
  cells: Record<string, DataCell>;
}

/** Badge tones for enum columns' values; the activity log's categories are the ones that have any. */
const ENUM_TONES: Partial<Record<string, Tone>> = {
  [ActivityCategory.COMMAND]: 'command',
  [ActivityCategory.EVENT]: 'viewer',
  [ActivityCategory.STATUS]: 'idle',
  [ActivityCategory.ERROR]: 'error',
  [ActivityCategory.CHAT]: 'chat',
} satisfies Record<ActivityCategory, Tone>;

export function DataPage() {
  const { table: tableName } = useParams();
  const { tables, error } = useDataTables();

  if (!tableName) {
    const first = tables[0];
    return first ? (
      <Navigate to={`/data/${first.name}`} replace />
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

function TableInspector({ info }: { info: DataTableInfo }) {
  const { request } = useWebSocketContext();
  const [search, setSearch] = useState('');
  const [facets, setFacets] = useState<Record<string, Set<string>>>({});
  const [range, setRange] = useState<DateRange>('all');
  const [sorting, setSorting] = useState<SortingState>([]);
  const [visibility, setVisibility] = useState<VisibilityState>({});
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const debouncedSearch = useDebounced(search.trim());

  const timeColumn = info.columns.find((column) => column.isTimestamp);
  const since = rangeStart(range);
  const filters = Object.fromEntries(
    Object.entries(facets)
      .filter(([, values]) => values.size > 0)
      .map(([column, values]) => [column, [...values]])
  );
  const sort = sorting[0];
  const query: Omit<DataQueryRowsPayload, 'page' | 'pageSize'> = {
    table: info.name,
    ...(sort ? { sort: { column: sort.id, direction: sort.desc ? 'desc' : 'asc' } } : {}),
    ...(Object.keys(filters).length > 0 ? { filters } : {}),
    ...(debouncedSearch ? { search: debouncedSearch } : {}),
    ...(since === undefined ? {} : { since }),
  };
  const { rows, total, loading, error } = useDataRows({ ...query, page, pageSize });

  const keyed = useMemo<DataRow[]>(
    () => rows.map((cells, index) => ({ cells, rowKey: `${page}:${index}` })),
    [rows, page]
  );

  const columns = useMemo<ColumnDef<DataRow>[]>(
    () =>
      info.columns.map((column) => ({
        id: column.name,
        accessorFn: (row) => row.cells[column.name],
        header: ({ column: tableColumn }) => (
          <DataTableColumnHeader
            column={tableColumn}
            title={column.name}
            className="font-mono normal-case"
          />
        ),
        enableSorting: !column.masked,
        size: column.isTimestamp ? 170 : column.isJson ? 240 : column.enumValues ? 120 : 160,
        meta: column.isJson ? { grow: true } : {},
        cell: ({ row }) => <Cell column={column} value={row.original.cells[column.name] ?? null} />,
      })),
    [info.columns]
  );

  const table = useReactTable({
    data: keyed,
    columns,
    state: { sorting, columnVisibility: visibility },
    onSortingChange: (updater) => {
      setSorting(updater);
      setPage(0);
    },
    onColumnVisibilityChange: setVisibility,
    manualSorting: true,
    enableMultiSort: false,
    getRowId: (row) => row.rowKey,
    getCoreRowModel: getCoreRowModel(),
  });

  const selected = keyed.find((row) => row.rowKey === selectedKey) ?? null;

  const exportCsv = async () => {
    setExporting(true);
    try {
      const all: Record<string, DataCell>[] = [];
      for (let next = 0; all.length < total && next < 50; next++) {
        const { rows } = await request(MessageType.DATA_QUERY_ROWS, {
          ...query,
          page: next,
          pageSize: MAX_DATA_PAGE_SIZE,
        });
        all.push(...rows);
        if (rows.length < MAX_DATA_PAGE_SIZE) {
          break;
        }
      }
      download(`${info.name}.csv`, toCsv(info.columns, all));
    } catch (caught) {
      toast.error('Export failed', { description: messageOf(caught) });
    } finally {
      setExporting(false);
    }
  };

  const enumColumns = info.columns.filter((column) => column.enumValues);

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col gap-4 px-8 py-6">
        <div className="flex items-center gap-3">
          <h2 className="font-mono text-[22px] font-semibold">{info.name}</h2>
          <Badge variant="secondary" className="gap-1">
            <Lock className="size-3" />
            Read-only
          </Badge>
          <span className="ml-auto text-sm text-muted-foreground">
            {total.toLocaleString()} {total === 1 ? 'row' : 'rows'}
            {total !== info.rowCount && ` of ${info.rowCount.toLocaleString()}`}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-64">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(0);
              }}
              placeholder="Search data…"
              className="pl-8"
            />
          </div>
          {enumColumns.map((column) => (
            <DataTableFacetedFilter
              key={column.name}
              title={column.name}
              options={(column.enumValues ?? []).map((value) => ({
                value,
                label: value,
              }))}
              selected={facets[column.name] ?? new Set()}
              onChange={(next) => {
                setFacets((current) => ({ ...current, [column.name]: next }));
                setPage(0);
              }}
            />
          ))}
          {timeColumn && (
            <DateRangeSelect
              value={range}
              onChange={(next) => {
                setRange(next);
                setPage(0);
              }}
            />
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
            loading={loading}
            onRowClick={(row) => setSelectedKey(row.rowKey)}
            selectedRowId={selectedKey}
            empty={error ?? 'No rows.'}
          />
        </div>
        <DataTablePagination
          page={page}
          pageCount={Math.ceil(total / pageSize)}
          onPageChange={(next) => {
            setPage(next);
            setSelectedKey(null);
          }}
          pageSize={pageSize}
          pageSizes={DATA_PAGE_SIZES}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(0);
            setSelectedKey(null);
          }}
        />
      </div>
      {selected && <RowPanel info={info} row={selected} onClose={() => setSelectedKey(null)} />}
    </div>
  );
}

function Cell({ column, value }: { column: DataColumnInfo; value: DataCell }) {
  if (value === null) {
    return <span className="font-mono text-[12.5px] text-subtle-foreground">null</span>;
  }
  if (column.masked) {
    return <span className="font-mono text-[12.5px] text-subtle-foreground italic">{value}</span>;
  }
  if (column.enumValues) {
    return <DotBadge tone={ENUM_TONES[String(value)] ?? 'idle'}>{value}</DotBadge>;
  }
  if (column.isTimestamp && typeof value === 'number') {
    return (
      <span className="font-mono text-[12.5px] tabular-nums" title={String(value)}>
        {formatDateTime(value)}
      </span>
    );
  }
  return (
    <span
      className={
        column.isJson ? 'font-mono text-[12.5px] text-muted-foreground' : 'font-mono text-[12.5px]'
      }
      title={String(value)}
    >
      {value}
    </span>
  );
}

function prettyJson(value: DataCell): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return null;
  }
}

function RowPanel({
  info,
  row,
  onClose,
}: {
  info: DataTableInfo;
  row: DataRow;
  onClose: () => void;
}) {
  const jsonColumns = info.columns.filter((column) => column.isJson);
  const plainColumns = info.columns.filter((column) => !column.isJson);
  const cells = row.cells;
  const first = info.columns[0];
  const title = cells.event ?? cells.name ?? cells.key ?? (first ? cells[first.name] : null);

  return (
    <aside className="flex w-[380px] shrink-0 flex-col gap-5 overflow-y-auto border-l p-6">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate font-mono text-base font-semibold">{String(title ?? 'Row')}</h3>
          {first && title !== cells[first.name] && (
            <p className="truncate font-mono text-xs text-muted-foreground">
              {String(cells[first.name])}
            </p>
          )}
        </div>
        <Button variant="ghost" size="icon" className="size-7" onClick={onClose} aria-label="Close">
          <X />
        </Button>
      </div>

      <dl className="flex flex-col text-[13px]">
        {plainColumns.map((column) => {
          const value = cells[column.name] ?? null;
          return (
            <div key={column.name} className="flex gap-4 border-b py-2.5">
              <dt className="shrink-0 text-muted-foreground">{column.name}</dt>
              <dd className="ml-auto min-w-0 text-right font-mono text-[12.5px] break-all">
                {value === null
                  ? 'null'
                  : column.isTimestamp && typeof value === 'number'
                    ? `${value} · ${formatDateTime(value)}`
                    : String(value)}
              </dd>
            </div>
          );
        })}
      </dl>

      {jsonColumns.map((column) => {
        const value = cells[column.name] ?? null;
        const pretty = prettyJson(value);
        return (
          <div key={column.name} className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs font-medium">{column.name}</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-muted-foreground"
                onClick={() => void copyToClipboard(pretty ?? String(value), 'JSON')}
              >
                <Copy />
                Copy JSON
              </Button>
            </div>
            <pre className="overflow-x-auto rounded-lg border bg-muted/40 p-4 font-mono text-[12.5px] leading-[1.65]">
              {pretty ?? String(value)}
            </pre>
          </div>
        );
      })}

      <p className="mt-auto flex gap-2.5 rounded-lg border p-3 text-xs text-muted-foreground">
        <Shield className="size-4 shrink-0" />
        <span>
          Read-only connection. Encrypted columns like{' '}
          <code className="font-mono text-foreground">integration_state.config</code> are never
          decrypted for display.
        </span>
      </p>
    </aside>
  );
}

function download(filename: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
