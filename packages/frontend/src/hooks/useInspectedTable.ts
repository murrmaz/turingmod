import type { OnChangeFn, SortingState } from '@tanstack/react-table';
import type { DataCell, DataRowsQuery, DataTableInfo } from '@turingmod/shared';
import { useCallback, useMemo, useState } from 'react';
import { type DateRange, rangeStart } from '@/lib/dateRange';
import { useDataRows } from './useDataRows';
import { useDebounced } from './useDebounced';

/** A row of the page shown, keyed by its place on it, since a table need not have an id column. */
export interface InspectedRow {
  rowKey: string;
  cells: Record<string, DataCell>;
}

/** What the Data page reads of a table, every page but which one. */
export type InspectorQuery = Omit<DataRowsQuery, 'page' | 'pageSize'>;

/**
 * One table on the Data page: what's read of it (search, the values each enum column is narrowed
 * to, a time range and a sort), the page of rows that reads, and the row selected. Changing what's
 * read goes back to the first page with nothing selected, since a row is keyed by its place on
 * the page and the same place now holds another row.
 */
export function useInspectedTable(info: DataTableInfo) {
  const [search, setSearchText] = useState('');
  const [facets, setFacets] = useState<Record<string, ReadonlySet<string>>>({});
  const [range, setRangeValue] = useState<DateRange>('all');
  const [sorting, setSortingState] = useState<SortingState>([]);
  const [page, setPageNumber] = useState(0);
  const [pageSize, setPageSizeValue] = useState(50);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const settledSearch = useDebounced(search.trim());

  /** Show `next` page with nothing selected. */
  const goTo = useCallback((next: number) => {
    setPageNumber(next);
    setSelectedKey(null);
  }, []);

  const setSearch = useCallback(
    (text: string) => {
      setSearchText(text);
      goTo(0);
    },
    [goTo]
  );
  const setFacet = useCallback(
    (column: string, values: ReadonlySet<string>) => {
      setFacets((current) => ({ ...current, [column]: values }));
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
  const setSorting: OnChangeFn<SortingState> = useCallback(
    (updater) => {
      setSortingState(updater);
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

  const since = rangeStart(range);
  const filters = Object.fromEntries(
    Object.entries(facets)
      .filter(([, values]) => values.size > 0)
      .map(([column, values]) => [column, [...values]])
  );
  const sort = sorting[0];
  const query: InspectorQuery = {
    table: info.name,
    ...(sort ? { sort: { column: sort.id, direction: sort.desc ? 'desc' : 'asc' } } : {}),
    ...(Object.keys(filters).length > 0 ? { filters } : {}),
    ...(settledSearch ? { search: settledSearch } : {}),
    ...(since === undefined ? {} : { since }),
  };
  const { rows, total, loading, error } = useDataRows({ ...query, page, pageSize });

  const keyed = useMemo<InspectedRow[]>(
    () => rows.map((cells, index) => ({ cells, rowKey: `${page}:${index}` })),
    [rows, page]
  );

  return {
    query,
    rows: keyed,
    total,
    loading,
    error,
    search,
    setSearch,
    facets,
    setFacet,
    range,
    setRange,
    sorting,
    setSorting,
    page,
    goTo,
    pageSize,
    setPageSize,
    selected: keyed.find((row) => row.rowKey === selectedKey) ?? null,
    selectedKey,
    select: setSelectedKey,
  };
}
