import type { SortingState } from '@tanstack/react-table';
import type { DataCell, DataRowsQuery, DataTableInfo } from '@turingmod/shared';
import { useCallback, useMemo, useState } from 'react';
import { type DateRange, rangeStart } from '@/lib/dateRange';
import { useDataRows } from './useDataRows';
import { useDebounced } from './useDebounced';
import { usePagedView } from './usePagedView';

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
 * read leaves nothing selected, at once rather than when typing pauses, since a row is keyed by its
 * place on the page and the same place is about to hold another row.
 */
export function useInspectedTable(info: DataTableInfo) {
  const [search, setSearch] = useState('');
  const [facets, setFacets] = useState<Record<string, ReadonlySet<string>>>({});
  const [range, setRange] = useState<DateRange>('all');
  const [sorting, setSorting] = useState<SortingState>([]);
  const settledSearch = useDebounced(search.trim());
  const filters = Object.fromEntries(
    Object.entries(facets)
      .filter(([, values]) => values.size > 0)
      .map(([column, values]) => [column, [...values]])
  );
  const { page, pageSize, selected, select, pagination } = usePagedView({
    search,
    filters,
    range,
    sorting,
  });

  const setFacet = useCallback((column: string, values: ReadonlySet<string>) => {
    setFacets((current) => ({ ...current, [column]: values }));
  }, []);

  const since = rangeStart(range);
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
    pagination: pagination(total),
    selected: keyed.find((row) => row.rowKey === selected) ?? null,
    selectedKey: selected,
    select,
  };
}
